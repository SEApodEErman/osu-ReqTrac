import { toDateInputValue } from './dates.js';

const CSV_COLUMNS = [
  ['Artist', request => request.artist],
  ['Title', request => request.title],
  ['Mapper', request => request.creator],
  ['Requester', request => request.requester_username],
  ['Categories', request => (request.categories || []).map(category => category.category_name).join('; ')],
  ['Request status', request => request.request_status],
  ['Priority', request => request.priority],
  ['Beatmap status', request => (request.is_osu_link ? request.ranked_status : 'Manual')],
  ['Deadline', request => toDateInputValue(request.deadline)],
  ['Added', request => toDateInputValue(request.added_date)],
  ['Completed', request => toDateInputValue(request.completed_date)],
  ['Tags', request => (request.tags || []).join('; ')],
  ['Notes', request => request.notes],
  ['Beatmap link', request => (request.beatmapset_id ? `https://osu.ppy.sh/beatmapsets/${request.beatmapset_id}` : request.input_link)],
];

function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet apps from evaluating cells that look like formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function requestsToCsv(requests) {
  const lines = [CSV_COLUMNS.map(([header]) => header).join(',')];
  for (const request of requests || []) {
    lines.push(CSV_COLUMNS.map(([, read]) => escapeCell(read(request))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadTextFile(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
