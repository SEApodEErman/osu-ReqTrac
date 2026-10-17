const BEATMAP_LINK_PATTERN = /(?:https?:\/\/)?osu\.ppy\.sh\/(?:beatmapsets|beatmaps|b|s)\/\d+[^\s]*/i;
const BEATMAPSET_ID_PATTERN = /osu\.ppy\.sh\/(?:beatmapsets|s)\/(\d+)/i;
const BEATMAP_ID_PATTERNS = [/osu\.ppy\.sh\/beatmapsets\/\d+(?:#\w+)?\/(\d+)/i, /osu\.ppy\.sh\/(?:beatmaps|b)\/(\d+)/i];

export function isOsuBeatmapLink(text) {
  return BEATMAP_LINK_PATTERN.test(String(text || ''));
}

// First osu! beatmap link inside arbitrary text (clipboard, dropped data).
export function extractOsuBeatmapLink(text) {
  const match = String(text || '').match(BEATMAP_LINK_PATTERN);
  if (!match) return null;
  const link = match[0].replace(/[)\]>.,;'"]+$/, '');
  return link.startsWith('http') ? link : `https://${link}`;
}

// Every distinct osu! beatmap link in a block of text, in order.
export function extractOsuBeatmapLinks(text) {
  const pattern = new RegExp(BEATMAP_LINK_PATTERN.source, 'gi');
  const links = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(pattern)) {
    const link = extractOsuBeatmapLink(match[0]);
    const key = link.toLowerCase();
    if (link && !seen.has(key)) {
      seen.add(key);
      links.push(link);
    }
  }
  return links;
}

export function beatmapsetIdFromLink(text) {
  const match = String(text || '').match(BEATMAPSET_ID_PATTERN);
  return match ? Number(match[1]) : null;
}

export function beatmapIdFromLink(text) {
  for (const pattern of BEATMAP_ID_PATTERNS) {
    const match = String(text || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function beatmapsetUrl(beatmapsetId) {
  return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}`;
}

export function beatmapsetDiscussionUrl(beatmapsetId) {
  return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}/discussion`;
}

export function userProfileUrl(userId) {
  return `https://osu.ppy.sh/users/${userId}`;
}

export function openExternal(url) {
  if (!url) return;
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
