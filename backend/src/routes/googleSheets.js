const express = require('express');
const crypto = require('crypto');
const { getDatabase } = require('../db');
const { buildPublicSnapshot } = require('../utils/publicSnapshot');
const { getGoogleConfig } = require('../googleConfig');

let safeStorage = null;
try {
  ({ safeStorage } = require('electron'));
} catch {
  // Standalone backend runs without Electron. Environment-only development
  // usage still works, but packaged desktop tokens use OS-backed encryption.
}

const router = express.Router();
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'];
const pendingStates = new Map();

function credentials() {
  return getGoogleConfig();
}

function redirectUri(req) {
  return `http://${req.get('host')}/api/google/callback`;
}

function requireConfigured(res) {
  const { clientId } = credentials();
  if (clientId) return true;
  res.status(400).json({ error: 'Google Sheets is not configured.', setup: 'The app maintainer must bundle a Google Desktop OAuth client ID.' });
  return false;
}

async function settings(db, keys) {
  const rows = await db.all(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`, keys);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function save(db, key, value) {
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

function protectToken(value) {
  if (!value || !safeStorage?.isEncryptionAvailable?.()) return value || '';
  return `enc:${safeStorage.encryptString(value).toString('base64')}`;
}

function unprotectToken(value) {
  if (!value || !value.startsWith('enc:') || !safeStorage?.isEncryptionAvailable?.()) return value || '';
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  } catch {
    return '';
  }
}

function unprotectStoredTokens(stored) {
  return {
    ...stored,
    google_access_token: unprotectToken(stored.google_access_token),
    google_refresh_token: unprotectToken(stored.google_refresh_token)
  };
}

async function saveToken(db, key, value) {
  await save(db, key, protectToken(value));
}

async function googleFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data?.error?.message || data?.error_description || data?.error || `Google API error (${response.status})`);
  return data;
}

async function tokenFromCode(req, code, verifier) {
  const { clientId, clientSecret } = credentials();
  const body = { code, client_id: clientId, redirect_uri: redirectUri(req), grant_type: 'authorization_code', code_verifier: verifier };
  if (clientSecret) body.client_secret = clientSecret;
  return googleFetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
}

async function accessToken(db, stored) {
  if (stored.google_access_token) return stored.google_access_token;
  if (!stored.google_refresh_token) throw new Error('Google account is not connected.');
  const { clientId, clientSecret } = credentials();
  const refreshToken = unprotectToken(stored.google_refresh_token);
  const body = { client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' };
  if (clientSecret) body.client_secret = clientSecret;
  const result = await googleFetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
  await saveToken(db, 'google_access_token', result.access_token);
  return result.access_token;
}

async function authorized(db, stored, url, options = {}) {
  const safeStored = unprotectStoredTokens(stored);
  let token = await accessToken(db, safeStored);
  const call = (currentToken) => googleFetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${currentToken}` } });
  try { return await call(token); } catch (error) {
    if (!safeStored.google_refresh_token) throw error;
    await saveToken(db, 'google_access_token', '');
    token = await accessToken(db, { ...safeStored, google_access_token: '' });
    return call(token);
  }
}

const CATEGORY_SHEETS = ['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others'];
const CATEGORY_LAYOUTS = {
  Hitsounds: { metricHeader: 'Highest Stars', metricKey: 'highestStars' },
  'Guest Difficulties': { metricHeader: 'GD Star Rating', metricKey: 'guestStars' },
  Storyboards: { metricHeader: 'Tags', metricKey: 'tags' },
  Others: { metricHeader: 'Tags', metricKey: 'tags' }
};

function sheetDate(value) {
  if (!value) return '';
  const dateText = String(value).slice(0, 10);
  const [year, month, day] = dateText.split('-').map(Number);
  if (!year || !month || !day) return '';
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
}

function categoryRows(snapshot, category) {
  const layout = CATEGORY_LAYOUTS[category];
  const headers = ['Artist', 'Title', 'Creator', 'Difficulties', layout.metricHeader, 'Map Status', 'Request Status', 'Priority', 'Deadline', 'Added Date', 'Completed Date', 'osu! Link'];
  const rows = snapshot.requests
    .filter((request) => request.categories.includes(category))
    .map((request) => [
      request.artist || '', request.title || '', request.creator || '',
      request.numDifficulties ? `${request.numDifficulties} ${request.numDifficulties === 1 ? 'diff' : 'diffs'}` : '—',
      layout.metricKey === 'tags' ? (request.tags || []).join(', ') || '—' : (Number(request[layout.metricKey]) ? Number(request[layout.metricKey]).toFixed(2) : '—'),
      request.mapStatus || 'Manual', request.status || '', request.priority || '',
      sheetDate(request.deadline), sheetDate(request.addedDate), sheetDate(request.completedDate), request.osuUrl || ''
    ]);
  return [headers, ...rows];
}

function hexColor(hex) {
  return { red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 };
}

function sheetTheme(theme = 'light') {
  const isDark = theme === 'dark';
  return {
    osuPink: hexColor('#E84F91'),
    text: hexColor(isDark ? '#F2F2F2' : '#262626'),
    background: hexColor(isDark ? '#3B3B3B' : '#FFFFFF'),
    alternate: hexColor(isDark ? '#464646' : '#F3F3F3'),
    card: hexColor(isDark ? '#505050' : '#EEEEEE'),
    white: hexColor('#FFFFFF')
  };
}

function colorRule(sheetId, column, value, background, foreground, rowCount) {
  return { addConditionalFormatRule: { rule: { ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: column, endColumnIndex: column + 1 }], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=LOWER(${columnLetter(column)}2)="${value.toLowerCase()}"` }] }, format: { backgroundColor: hexColor(background), textFormat: { bold: true, foregroundColor: hexColor(foreground) } } } }, index: 0 } };
}

function columnLetter(index) {
  let value = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function categoryFormatting(sheet, rowCount, theme) {
  const sheetId = sheet.properties.sheetId;
  const columnCount = 12;
  const { osuPink, text, background, alternate, white } = sheetTheme(theme);
  const requests = [
    { updateCells: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0 }, fields: 'userEnteredValue' } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } }, fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: background, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, foregroundColor: text }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 11, bold: true, foregroundColor: white }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount }, top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' }, innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' } } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount } } } }
  ];

  [150, 240, 160, 110, 125, 120, 125, 100, 120, 120, 120, 220].forEach((pixelSize, index) => {
    requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize }, fields: 'pixelSize' } });
  });
  [8, 9, 10].forEach((column) => {
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: column, endColumnIndex: column + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd-mmm-yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } });
  });
  requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: hexColor('#1155CC'), underline: true } } }, fields: 'userEnteredFormat.textFormat' } });

  (sheet.bandedRanges || []).forEach((bandedRange) => {
    if (bandedRange.bandedRangeId !== undefined) requests.push({ deleteBanding: { bandedRangeId: bandedRange.bandedRangeId } });
  });
  if (rowCount > 1) {
    requests.push({ addBanding: { bandedRange: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount }, rowProperties: { firstBandColor: background, secondBandColor: alternate } } } });
  }
  (sheet.conditionalFormats || []).forEach((_rule, index, rules) => {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: rules.length - index - 1 } });
  });
  if (rowCount > 1) {
    const colors = [
      [6, 'accepted', '#d7f4ed', '#008e6a'], [6, 'considering', '#fff0d7', '#a86600'], [6, 'working', '#d9ecfb', '#247bb8'], [6, 'completed', '#d9f7e5', '#208d4e'], [6, 'cancelled', '#fbdedb', '#bf3b2c'],
      [7, 'low', '#d9ecfb', '#247bb8'], [7, 'medium', '#fff0d7', '#a86600'], [7, 'high', '#fbdedb', '#bf3b2c'],
      [5, 'ranked', '#e8f2c7', '#5f7d00'], [5, 'loved', '#fde1ee', '#c43f7c'], [5, 'qualified', '#d9f1ff', '#0079b5'], [5, 'pending', '#fff0d7', '#a86600'], [5, 'wip', '#fff0d7', '#a86600'], [5, 'graveyard', '#ededf0', '#6f6d77']
    ];
    colors.forEach(([column, value, background, foreground]) => requests.push(colorRule(sheetId, column, value, background, foreground, rowCount)));
  }
  return requests;
}

function dashboardRows(snapshot) {
  const { stats } = snapshot;
  const rows = [
    [`${snapshot.ownerUsername || 'osu!ReqTrac'}'s Requests Log`, '', '', ''],
    ['Last synced', new Date(snapshot.exportedAt).toISOString().slice(0, 10), '', ''],
    ['', '', '', ''],
    ['Overview', '', '', ''],
    ['Total Requests', stats.total, 'Active', stats.active],
    ['Completed', stats.completed, 'Due This Week', stats.dueSoon],
    ['', '', '', ''],
    ['Statistics', '', '', ''],
    ['Completed Requests', stats.completedCount, 'Drain Time Worked', stats.totalDrainTime],
    ['Ranked Completed', stats.rankedCompletedCount, 'Top Requester', stats.mostFrequentRequester || '—'],
    ['', '', '', ''],
    ['Yearly Breakdown', '', '', ''],
    ['Year', 'Completed', 'Drain Time', 'Top User']
  ];

  (stats.yearSummary || []).forEach((year) => rows.push([year.year, year.completedCount, year.totalDrainTime, year.mostRequestedUser || '—']));
  rows.push(['', '', '', ''], ['Requester Breakdown', '', '', ''], ['Username', 'Requests', '', '']);
  (stats.requesterBreakdown || []).forEach((requester) => rows.push([requester.username, requester.count, '', '']));

  return {
    rows,
    layout: {
      overviewHeader: 3,
      statsHeader: 7,
      yearlySection: 11,
      yearlyHeader: 12,
      requesterSection: 14 + (stats.yearSummary || []).length,
      requesterHeader: 15 + (stats.yearSummary || []).length
    }
  };
}

function dashboardFormatting(sheetId, rowCount, layout, theme) {
  const { osuPink, text, background, alternate, card, white } = sheetTheme(theme);
  const blue = hexColor('#D9ECFB');
  const green = hexColor('#D9F7E5');
  const red = hexColor('#FBDedb');
  const requests = [
    { updateCells: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0 }, fields: 'userEnteredValue' } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2, hideGridlines: true } }, fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: background, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, foregroundColor: text }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 16, bold: true, foregroundColor: white }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.overviewHeader, endRowIndex: layout.overviewHeader + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 12, bold: true, foregroundColor: white }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.statsHeader, endRowIndex: layout.statsHeader + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 12, bold: true, foregroundColor: white }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.yearlySection, endRowIndex: layout.yearlySection + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 12, bold: true, foregroundColor: white }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.yearlyHeader, endRowIndex: layout.yearlyHeader + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, bold: true, foregroundColor: white }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.requesterSection, endRowIndex: layout.requesterSection + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 12, bold: true, foregroundColor: white }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId, startRowIndex: layout.requesterHeader, endRowIndex: layout.requesterHeader + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: osuPink, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, bold: true, foregroundColor: white }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 4 }, top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' }, innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' } } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } }
  ];

  const fillRange = (startRowIndex, endRowIndex, startColumnIndex, endColumnIndex, backgroundColor, foregroundColor = text, bold = false) => requests.push({ repeatCell: { range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }, cell: { userEnteredFormat: { backgroundColor, textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, bold, foregroundColor }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } });
  fillRange(4, 5, 0, 2, card);
  fillRange(4, 5, 2, 4, blue, hexColor('#247BB8'), true);
  fillRange(5, 6, 0, 2, green, hexColor('#208D4E'), true);
  fillRange(5, 6, 2, 4, red, hexColor('#BF3B2C'), true);
  fillRange(8, 10, 0, 4, alternate);
  fillRange(13, layout.requesterSection, 0, 4, background);
  if (layout.requesterSection > 15) fillRange(15, layout.requesterSection, 0, 4, alternate);
  requests.push({ repeatCell: { range: { sheetId, startRowIndex: 13, endRowIndex: layout.requesterSection, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'JetBrains Mono', fontSize: 10, foregroundColor: hexColor('#1155CC'), underline: true } } }, fields: 'userEnteredFormat.textFormat' } });
  requests.push({ repeatCell: { range: { sheetId, startRowIndex: layout.yearlyHeader + 1, endRowIndex: layout.requesterSection - 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } }, fields: 'userEnteredFormat.numberFormat' } });
  return requests;
}

async function syncSheet(db, stored, snapshot, theme) {
  let spreadsheetId = stored.google_sheet_id;
  let spreadsheet;
  const sheetFields = 'sheets.properties,sheets.bandedRanges,sheets.conditionalFormats';
  if (!spreadsheetId) {
    spreadsheet = await authorized(db, stored, SHEETS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: 'osu!ReqTrac Public Table' }, sheets: [{ properties: { title: 'Dashboard' } }, ...CATEGORY_SHEETS.map((title) => ({ properties: { title } }))] })
    });
    spreadsheetId = spreadsheet.spreadsheetId;
    await save(db, 'google_sheet_id', spreadsheetId);
  } else {
    spreadsheet = await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}?fields=${sheetFields}`, { method: 'GET' });
  }

  const existingSheets = new Map((spreadsheet.sheets || []).map((sheet) => [sheet.properties.title, sheet]));
  const structureChanges = [];
  if (!existingSheets.has('Dashboard')) structureChanges.push({ addSheet: { properties: { title: 'Dashboard' } } });
  CATEGORY_SHEETS.filter((title) => !existingSheets.has(title)).forEach((title) => structureChanges.push({ addSheet: { properties: { title } } }));
  if (existingSheets.has('Requests')) structureChanges.push({ deleteSheet: { sheetId: existingSheets.get('Requests').properties.sheetId } });
  if (structureChanges.length) {
    await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: structureChanges }) });
    spreadsheet = await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}?fields=${sheetFields}`, { method: 'GET' });
  }

  const sheetMap = new Map((spreadsheet.sheets || []).map((sheet) => [sheet.properties.title, sheet]));
  const dashboardSheet = sheetMap.get('Dashboard');
  const dashboardModel = dashboardRows(snapshot);
  const dashboard = dashboardModel.rows;
  const formattingRequests = dashboardFormatting(dashboardSheet.properties.sheetId, dashboard.length, dashboardModel.layout, theme);
  CATEGORY_SHEETS.forEach((category) => formattingRequests.push(...categoryFormatting(sheetMap.get(category), categoryRows(snapshot, category).length, theme)));

  await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: formattingRequests }) });
  await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent("'Dashboard'!A1:D" + dashboard.length)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range: `'Dashboard'!A1:D${dashboard.length}`, majorDimension: 'ROWS', values: dashboard }) });

  for (const category of CATEGORY_SHEETS) {
    const rows = categoryRows(snapshot, category);
    const range = `'${category}'!A1:L${Math.max(rows.length, 1)}`;
    await authorized(db, stored, `${SHEETS_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }) });
  }

  await authorized(db, stored, `${DRIVE_URL}/${spreadsheetId}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader' }) }).catch((error) => { if (!/already exists|duplicate/i.test(error.message)) throw error; });
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=sharing`;
  await save(db, 'google_sheet_url', url);
  return { spreadsheetId, url, syncedAt: snapshot.exportedAt };
}

router.get('/status', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    const stored = await settings(db, ['google_refresh_token', 'google_sheet_url', 'google_sheet_synced_at']);
    const { clientId } = credentials();
    res.json({ configured: !!clientId, connected: !!stored.google_refresh_token, sheetUrl: stored.google_sheet_url || null, syncedAt: stored.google_sheet_synced_at || null });
  } catch (error) { next(error); }
});

router.get('/auth-url', (req, res) => {
  if (!requireConfigured(res)) return;
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, verifier });
  const { clientId } = credentials();
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(req), response_type: 'code', access_type: 'offline', prompt: 'consent', scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  res.json({ url: url.toString() });
});

router.get('/callback', async (req, res) => {
  const pending = pendingStates.get(req.query.state);
  pendingStates.delete(req.query.state);
  if (!pending || pending.expiresAt < Date.now()) return res.status(400).send('Google authorization expired. Return to ReqTrac and try again.');
  if (req.query.error) return res.status(400).send(`Google authorization failed: ${req.query.error}`);
  try {
    const tokenData = await tokenFromCode(req, req.query.code, pending.verifier);
    const db = await getDatabase();
    await saveToken(db, 'google_access_token', tokenData.access_token || '');
    if (tokenData.refresh_token) await saveToken(db, 'google_refresh_token', tokenData.refresh_token);
    // The authorization starts in the user's external browser. Hand control
    // back to the installed app instead of loading the local UI in Chrome.
    res.type('html').send(`<!doctype html>
      <html><head><meta charset="utf-8"><title>Returning to osu!ReqTrac</title></head>
      <body style="font-family: sans-serif; padding: 2rem">
        <p>Authorization complete. Returning to osu!ReqTrac…</p>
        <a href="osureqtrac://oauth-complete">Return to osu!ReqTrac</a>
        <script>window.location.replace('osureqtrac://oauth-complete');</script>
      </body></html>`);
  } catch (error) { res.status(500).send(`Google authorization failed: ${error.message}`); }
});

router.post('/sync', async (req, res, next) => {
  try {
    if (!requireConfigured(res)) return;
    const db = await getDatabase();
    const stored = unprotectStoredTokens(await settings(db, ['google_access_token', 'google_refresh_token', 'google_sheet_id']));
    if (!stored.google_refresh_token) return res.status(400).json({ error: 'Connect a Google account first.' });
    const theme = req.body?.theme === 'dark' ? 'dark' : 'light';
    const result = await syncSheet(db, stored, await buildPublicSnapshot(), theme);
    await save(db, 'google_sheet_synced_at', result.syncedAt);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/disconnect', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    await db.run("DELETE FROM settings WHERE key IN ('google_access_token', 'google_refresh_token', 'google_sheet_id', 'google_sheet_url', 'google_sheet_synced_at')");
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
