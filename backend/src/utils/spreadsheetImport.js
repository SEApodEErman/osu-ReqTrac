const XLSX = require('xlsx');
const { parseOsuLink } = require('./requestUtils');

const IMPORT_FIELDS = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'link', label: 'Beatmap Link' },
  { value: 'artist', label: 'Artist' },
  { value: 'title', label: 'Title' },
  { value: 'creator', label: 'Creator' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'notes', label: 'Notes' },
  { value: 'requester', label: 'Requester' },
  { value: 'status', label: 'Request Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'addedDate', label: 'Added Date' },
  { value: 'completedDate', label: 'Completed Date' },
  { value: 'discordLink', label: 'Discord Link' },
  { value: 'osuProfileLink', label: 'osu! Profile Link' },
  { value: 'category', label: 'Category' }
];

const HEADER_ALIASES = {
  link: ['osu link', 'beatmap link', 'beatmap url', 'map link', 'url'],
  artist: ['artist'],
  title: ['title', 'song title'],
  creator: ['creator', 'mapper', 'beatmap creator'],
  difficulty: ['difficulty', 'difficulties', 'version'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment', 'description'],
  requester: ['requester', 'requested by', 'requester username'],
  status: ['request status', 'status'],
  priority: ['priority'],
  deadline: ['deadline', 'due date'],
  addedDate: ['added date', 'date added', 'year'],
  completedDate: ['completed date', 'date completed'],
  discordLink: ['discord link', 'discord'],
  osuProfileLink: ['osu profile link', 'osu profile', 'profile link'],
  category: ['category', 'categories', 'request category']
};

const VALID_STATUSES = new Set(['Accepted', 'Considering', 'Working', 'Completed', 'Cancelled']);
const VALID_PRIORITIES = new Set(['Low', 'Medium', 'High']);
const VALID_CATEGORIES = new Set(['Hitsounds', 'Guest Difficulties', 'Storyboards', 'Others']);
const BEATMAP_LINK_PATTERN = /^https?:\/\/(?:www\.)?osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b)\/\d+(?:[/?#].*)?$/i;

function cleanHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[!._-]+/g, ' ').replace(/\s+/g, ' ');
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeChoice(value, choices) {
  const found = [...choices].find(choice => choice.toLowerCase() === cleanText(value).toLowerCase());
  return found || null;
}

function normalizeDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{4}$/.test(text)) return `${text}-01-01`;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseCategoryList(value, defaults) {
  const suppliedCategories = cleanText(value)
    .split(/[,|;]/)
    .map(category => normalizeChoice(category, VALID_CATEGORIES))
    .filter(Boolean);
  return suppliedCategories.length > 0 ? [...new Set(suppliedCategories)] : defaults;
}

function suggestMapping(headers) {
  const usedFields = new Set();
  return Object.fromEntries(headers.map(header => {
    const normalizedHeader = cleanHeader(header);
    const field = Object.entries(HEADER_ALIASES)
      .find(([, aliases]) => aliases.includes(normalizedHeader))?.[0] || 'ignore';
    const mapping = field !== 'ignore' && !usedFields.has(field) ? field : 'ignore';
    if (mapping !== 'ignore') usedFields.add(mapping);
    return [header, mapping];
  }));
}

function validateMapping(headers, mapping) {
  const validFields = new Set(IMPORT_FIELDS.map(field => field.value));
  const mappedFields = new Set();
  const normalizedMapping = {};
  const errors = [];

  for (const header of headers) {
    const field = validFields.has(mapping?.[header]) ? mapping[header] : 'ignore';
    normalizedMapping[header] = field;
    if (field !== 'ignore') {
      if (mappedFields.has(field)) {
        errors.push(`Multiple columns are mapped to ${IMPORT_FIELDS.find(option => option.value === field).label}.`);
      }
      mappedFields.add(field);
    }
  }

  return { mapping: normalizedMapping, errors };
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length === 0) throw new Error('The spreadsheet does not contain any worksheets.');

  return workbook.SheetNames.map(name => {
    const values = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false });
    const [sourceHeaders = [], ...rows] = values;
    const headerCounts = new Map();
    const headers = sourceHeaders.map((header, index) => {
      const baseHeader = cleanText(header) || `Column ${index + 1}`;
      const count = (headerCounts.get(baseHeader) || 0) + 1;
      headerCounts.set(baseHeader, count);
      return count === 1 ? baseHeader : `${baseHeader} (${count})`;
    });
    return {
      name,
      headers,
      rows: rows.filter(row => row.some(value => cleanText(value)))
    };
  });
}

function normalizeRows(headers, rows, mapping, defaultCategories = ['Hitsounds']) {
  const { mapping: normalizedMapping, errors: mappingErrors } = validateMapping(headers, mapping);
  if (mappingErrors.length > 0) return { records: [], errors: mappingErrors };

  const records = rows.map((row, index) => {
    const record = { rowNumber: index + 2, categories: defaultCategories };
    headers.forEach((header, columnIndex) => {
      const field = normalizedMapping[header];
      if (field !== 'ignore') record[field] = cleanText(row[columnIndex]);
    });

    const errors = [];
    if (!record.link && !record.title && !record.artist && !record.creator) {
      errors.push('Provide a beatmap link or manual request details.');
    }
    if (record.link && (!BEATMAP_LINK_PATTERN.test(record.link) || !parseOsuLink(record.link))) {
      errors.push('Beatmap Link must be a valid osu! beatmap or beatmapset URL.');
    }

    record.status = record.status ? normalizeChoice(record.status, VALID_STATUSES) : 'Accepted';
    if (!record.status) errors.push('Request Status must be Accepted, Considering, Working, Completed, or Cancelled.');

    record.priority = record.priority ? normalizeChoice(record.priority, VALID_PRIORITIES) : 'Low';
    if (!record.priority) errors.push('Priority must be Low, Medium, or High.');

    for (const field of ['deadline', 'addedDate', 'completedDate']) {
      if (record[field]) {
        record[field] = normalizeDate(record[field]);
        if (record[field] === undefined) errors.push(`${IMPORT_FIELDS.find(option => option.value === field).label} is not a valid date.`);
      }
    }

    const suppliedCategory = cleanText(record.category);
    record.categories = parseCategoryList(record.category, defaultCategories);
    if (suppliedCategory && !suppliedCategory.split(/[,|;]/).some(category => normalizeChoice(category, VALID_CATEGORIES))) {
      errors.push('Category must contain a supported request category.');
    }
    delete record.category;

    return { ...record, errors };
  });

  return { records, errors: [] };
}

module.exports = {
  IMPORT_FIELDS,
  VALID_CATEGORIES,
  parseWorkbook,
  suggestMapping,
  validateMapping,
  normalizeRows
};
