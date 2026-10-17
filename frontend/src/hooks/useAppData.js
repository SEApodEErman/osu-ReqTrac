import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

// Owns the data every screen reads. Refreshes are coalesced: while one
// request-list fetch is running, further refresh calls share it and trigger a
// single follow-up fetch instead of stacking up.
export function useAppData({ onSettingsLoaded } = {}) {
  const [requests, setRequests] = useState([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsError, setRequestsError] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsCategoryId, setStatsCategoryIdState] = useState('all');
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);

  const requestsInflightRef = useRef(null);
  const requestsAgainRef = useRef(false);
  const statsCategoryRef = useRef('all');
  const statsRequestRef = useRef(0);
  const onSettingsLoadedRef = useRef(onSettingsLoaded);
  onSettingsLoadedRef.current = onSettingsLoaded;

  const refreshRequests = useCallback(() => {
    if (requestsInflightRef.current) {
      requestsAgainRef.current = true;
      return requestsInflightRef.current;
    }
    const run = async () => {
      do {
        requestsAgainRef.current = false;
        try {
          const data = await api.get('/api/requests');
          setRequests(Array.isArray(data) ? data : []);
          setRequestsLoaded(true);
          setRequestsError(null);
        } catch (error) {
          console.error('Failed to load requests:', error);
          setRequestsError(error);
        }
      } while (requestsAgainRef.current);
    };
    requestsInflightRef.current = run().finally(() => {
      requestsInflightRef.current = null;
    });
    return requestsInflightRef.current;
  }, []);

  // Re-read only the given rows (merging them into the list) instead of the
  // whole library. Rows the server no longer returns were deleted.
  const refreshRequestsById = useCallback(async (ids) => {
    const wanted = [...new Set((ids || []).map(Number).filter(Number.isSafeInteger))];
    if (wanted.length === 0) return;
    if (wanted.length > 400 || requestsInflightRef.current) {
      await refreshRequests();
      return;
    }
    try {
      const rows = await api.get(`/api/requests?ids=${wanted.join(',')}`);
      const byId = new Map((rows || []).map(row => [row.id, row]));
      const wantedSet = new Set(wanted);
      setRequests((current) => {
        const present = new Set();
        const merged = [];
        for (const request of current) {
          if (!wantedSet.has(request.id)) {
            merged.push(request);
          } else if (byId.has(request.id)) {
            present.add(request.id);
            merged.push(byId.get(request.id));
          }
        }
        const added = [...byId.values()].filter(row => !present.has(row.id));
        return added.length ? [...added, ...merged] : merged;
      });
    } catch (error) {
      console.error('Failed to refresh requests:', error);
      await refreshRequests();
    }
  }, [refreshRequests]);

  const removeRequestsLocally = useCallback((ids) => {
    const idSet = new Set(ids);
    setRequests(current => current.filter(request => !idSet.has(request.id)));
  }, []);

  const refreshStats = useCallback(async (categoryId = statsCategoryRef.current) => {
    const requestId = ++statsRequestRef.current;
    const query = categoryId === 'all' ? '' : `?categoryId=${encodeURIComponent(categoryId)}`;
    setStatsLoading(true);
    try {
      const data = await api.get(`/api/stats${query}`);
      if (requestId === statsRequestRef.current) setStats(data);
    } catch (error) {
      console.error('Failed to load statistics:', error);
    } finally {
      if (requestId === statsRequestRef.current) setStatsLoading(false);
    }
  }, []);

  const setStatsCategoryId = useCallback((categoryId) => {
    const normalized = categoryId === 'all' ? 'all' : String(categoryId);
    statsCategoryRef.current = normalized;
    setStatsCategoryIdState(normalized);
    void refreshStats(normalized);
  }, [refreshStats]);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await api.get('/api/settings');
      setSettings(data);
      onSettingsLoadedRef.current?.(data);
      return data;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return null;
    }
  }, []);

  const refreshCatalogs = useCallback(async () => {
    const [categoriesResult, tagsResult] = await Promise.allSettled([api.get('/api/categories'), api.get('/api/tags')]);
    if (categoriesResult.status === 'fulfilled') setCategories(categoriesResult.value || []);
    if (tagsResult.status === 'fulfilled') setTags(tagsResult.value || []);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshRequests(), refreshStats(), refreshSettings(), refreshCatalogs()]);
  }, [refreshCatalogs, refreshRequests, refreshSettings, refreshStats]);

  // Apply a change to rows immediately; the caller refreshes from the server after.
  const patchRequestsLocally = useCallback((ids, patch) => {
    const idSet = new Set(ids);
    setRequests(current => current.map(request => (idSet.has(request.id)
      ? { ...request, ...(typeof patch === 'function' ? patch(request) : patch) }
      : request)));
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Drop a dashboard category filter that no longer exists.
  useEffect(() => {
    if (statsCategoryId === 'all' || categories.length === 0) return;
    if (!categories.some(category => String(category.id) === statsCategoryId)) setStatsCategoryId('all');
  }, [categories, setStatsCategoryId, statsCategoryId]);

  return {
    requests,
    requestsLoaded,
    requestsError,
    stats,
    statsLoading,
    statsCategoryId,
    settings,
    categories,
    tags,
    setStatsCategoryId,
    refreshRequests,
    refreshRequestsById,
    removeRequestsLocally,
    refreshStats,
    refreshSettings,
    refreshCatalogs,
    refreshAll,
    patchRequestsLocally,
  };
}
