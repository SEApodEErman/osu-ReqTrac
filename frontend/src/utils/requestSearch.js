const TEXT_FILTERS = new Set(['creator', 'requester', 'artist', 'title', 'difficulty', 'tag', 'tags', 'category', 'type', 'status', 'request_status', 'beatmap_status', 'mapstatus', 'priority', 'mode']);
const NUMBER_FILTERS = new Set(['stars', 'star', 'keys', 'key', 'id', 'beatmapset', 'ar', 'cs', 'od', 'hp', 'bpm', 'length', 'drain']);
const DATE_FILTERS = new Set(['added', 'deadline']);

function tokenize(query) {
  const tokens = [];
  let token = '';
  let quoted = false;
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    if (character === '"') {
      quoted = !quoted;
      token += character;
    } else if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

export function parseRequestSearch(query) {
  const filters = [];
  const keywords = [];
  for (const token of tokenize(String(query || '').trim())) {
    const match = token.match(/^([a-z_]+)(:|=|>=|<=|>|<)(.*)$/i);
    if (!match) {
      keywords.push(token.replace(/^"|"$/g, ''));
      continue;
    }
    const [, rawKey, operator, rawValue] = match;
    const key = rawKey.toLowerCase();
    const value = rawValue.replace(/^"|"$/g, '').replace(/\\"/g, '');
    if (![...TEXT_FILTERS, ...NUMBER_FILTERS, ...DATE_FILTERS].includes(key) || !value) {
      keywords.push(token.replace(/^"|"$/g, ''));
      continue;
    }
    filters.push({ key, operator: operator === ':' ? '=' : operator, value: value.toLowerCase() });
  }
  return { filters, keywords: keywords.filter(Boolean).map(keyword => keyword.toLowerCase()) };
}

function includes(value, expected) {
  return String(value || '').toLowerCase().includes(expected);
}

function matchesComparison(actual, operator, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (operator === '=') return actual === expected;
  if (operator === '>') return actual > expected;
  if (operator === '>=') return actual >= expected;
  if (operator === '<') return actual < expected;
  if (operator === '<=') return actual <= expected;
  return false;
}

function difficultyValues(request, key) {
  const difficulties = request.search_difficulties || [];
  if (key === 'stars' || key === 'star') return difficulties.map(item => Number(item.stars));
  if (key === 'keys' || key === 'key') return difficulties.filter(item => item.mode === 'mania').map(item => Number(item.cs));
  if (key === 'length' || key === 'drain') return difficulties.map(item => Number(item.drain));
  return difficulties.map(item => Number(item[key]));
}

function matchesFilter(request, filter) {
  const { key, operator, value } = filter;
  if (TEXT_FILTERS.has(key)) {
    const values = {
      creator: [request.creator, ...(request.creator_aliases || [])],
      requester: [request.requester_username, ...(request.requester_aliases || [])],
      artist: [request.artist], title: [request.title], difficulty: (request.search_difficulties || []).map(item => item.name),
      tag: request.tags || [], tags: request.tags || [], category: (request.categories || []).map(item => item.category_name), type: (request.categories || []).map(item => item.category_name),
      status: [request.request_status], request_status: [request.request_status], beatmap_status: [request.ranked_status], mapstatus: [request.ranked_status],
      priority: [request.priority], mode: request.gamemodes || (request.search_difficulties || []).map(item => item.mode),
    }[key] || [];
    return operator === '=' && values.some(item => includes(item, value));
  }
  if (DATE_FILTERS.has(key)) {
    const actual = Date.parse(request[key === 'added' ? 'added_date' : 'deadline']);
    const expected = Date.parse(value);
    return matchesComparison(actual, operator, expected);
  }
  if (key === 'id' || key === 'beatmapset') return matchesComparison(Number(request.beatmapset_id), operator, Number(value));
  return difficultyValues(request, key).some(actual => matchesComparison(actual, operator, Number(value)));
}

export function requestMatchesSearch(request, query) {
  const { filters, keywords } = parseRequestSearch(query);
  if (!filters.every(filter => matchesFilter(request, filter))) return false;
  const haystack = [
    request.title, request.artist, request.creator, request.requester_username, request.notes, request.beatmapset_id,
    ...(request.creator_aliases || []), ...(request.requester_aliases || []), ...(request.tags || []),
    ...(request.categories || []).map(category => category.category_name), ...(request.search_difficulties || []).map(difficulty => difficulty.name),
  ].filter(Boolean).join(' ').toLowerCase();
  return keywords.every(keyword => haystack.includes(keyword));
}
