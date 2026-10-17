import { parseAppDate } from './dates.js';

export function requestBelongsToDashboardCategory(request, categoryId) {
  if (categoryId === 'all' || categoryId === null || categoryId === undefined) return true;
  const numericCategoryId = Number(categoryId);
  if (!Number.isSafeInteger(numericCategoryId) || numericCategoryId <= 0) return false;
  return (request?.categories || []).some(
    category => Number(category.category_id) === numericCategoryId
  );
}

export function getRecentDashboardRequests(requests, categoryId, limit = 5) {
  return (requests || [])
    .filter(request => requestBelongsToDashboardCategory(request, categoryId))
    .sort((a, b) => {
      // Newest first; requests without an added date (bulk imports) go last.
      const timeA = parseAppDate(a.added_date)?.getTime() ?? -Infinity;
      const timeB = parseAppDate(b.added_date)?.getTime() ?? -Infinity;
      return timeB - timeA || b.id - a.id;
    })
    .slice(0, limit);
}
