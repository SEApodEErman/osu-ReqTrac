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
    .sort((a, b) => new Date(b.added_date) - new Date(a.added_date))
    .slice(0, limit);
}
