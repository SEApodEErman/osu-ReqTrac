import { useCallback, useEffect } from 'react';
import { fetchWithTimeout } from '../api/client';

export function useAppData({
  dashboardCategoryIdRef,
  setActiveTab,
  setCategoryDefinitions,
  setDashboardCategoryId,
  setRequestsList,
  setSelectedRequest,
  setSettingsData,
  setShowFirstLaunchSetup,
  setStatsData,
  setStatsLoading,
  setTagCatalog,
  statsRequestIdRef,
}) {
  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/requests');
      if (!res.ok) return;
      const data = await res.json();
      setRequestsList(data);
      setSelectedRequest(current => {
        if (!current) return current;
        const updated = data.find(request => request.id === current.id);
        return updated ? { ...current, ...updated, difficulties: current.difficulties } : current;
      });
    } catch (error) {
      console.error('Error fetching requests list:', error);
    }
  }, [setRequestsList, setSelectedRequest]);

  const fetchStats = useCallback(async (categoryId = dashboardCategoryIdRef.current) => {
    const normalizedCategoryId = categoryId === 'all' ? 'all' : String(categoryId);
    const requestId = ++statsRequestIdRef.current;
    const endpoint = normalizedCategoryId === 'all'
      ? '/api/stats'
      : `/api/stats?categoryId=${encodeURIComponent(normalizedCategoryId)}`;
    setStatsLoading(true);
    try {
      const res = await fetchWithTimeout(endpoint);
      if (!res.ok) throw new Error(`Statistics request failed (${res.status}).`);
      const data = await res.json();
      if (requestId === statsRequestIdRef.current) setStatsData(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      if (requestId === statsRequestIdRef.current) setStatsLoading(false);
    }
  }, [dashboardCategoryIdRef, setStatsData, setStatsLoading, statsRequestIdRef]);

  const handleDashboardCategoryChange = useCallback((categoryId) => {
    const normalizedCategoryId = categoryId === 'all' ? 'all' : String(categoryId);
    dashboardCategoryIdRef.current = normalizedCategoryId;
    setDashboardCategoryId(normalizedCategoryId);
    setStatsData({});
    void fetchStats(normalizedCategoryId);
  }, [dashboardCategoryIdRef, fetchStats, setDashboardCategoryId, setStatsData]);

  const fetchCatalogs = useCallback(async () => {
    try {
      const [categoriesResponse, tagsResponse] = await Promise.all([
        fetchWithTimeout('/api/categories'),
        fetchWithTimeout('/api/tags'),
      ]);
      if (categoriesResponse.ok) setCategoryDefinitions(await categoriesResponse.json());
      if (tagsResponse.ok) setTagCatalog(await tagsResponse.json());
    } catch (error) {
      console.error('Failed to load categories or tags:', error);
    }
  }, [setCategoryDefinitions, setTagCatalog]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setSettingsData(data);
      if (!data.isConfigured && !localStorage.getItem('credentialsSetupPromptShown')) {
        localStorage.setItem('credentialsSetupPromptShown', '1');
        setActiveTab('settings');
        setShowFirstLaunchSetup(true);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }, [setActiveTab, setSettingsData, setShowFirstLaunchSetup]);

  const fetchData = useCallback(async () => {
    try {
      await Promise.all([fetchRequests(), fetchStats(), fetchSettings(), fetchCatalogs()]);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }, [fetchCatalogs, fetchRequests, fetchSettings, fetchStats]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    fetchCatalogs,
    fetchData,
    fetchRequests,
    fetchSettings,
    fetchStats,
    handleDashboardCategoryChange,
  };
}
