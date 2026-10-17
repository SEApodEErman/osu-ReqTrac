import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

const BULK_BATCH_SIZE = 400;
const UNDO_DELETE_MS = 6000;
const JOB_POLL_MS = 1000;

function batches(ids) {
  const result = [];
  for (let index = 0; index < ids.length; index += BULK_BATCH_SIZE) result.push(ids.slice(index, index + BULK_BATCH_SIZE));
  return result;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function summarizeDateRefresh(result = {}) {
  const parts = [`Updated ${plural(result.updated || 0, 'date')}.`];
  if (result.skippedManual?.length) parts.push(`Skipped ${plural(result.skippedManual.length, 'manual request')}.`);
  if (result.skippedNoUsableDate?.length) {
    const names = result.skippedNoUsableDate.slice(0, 3).map(item => item.title || `Request ${item.id}`).join(', ');
    const remainder = result.skippedNoUsableDate.length - 3;
    parts.push(`No usable osu! date for ${names}${remainder > 0 ? ` and ${remainder} more` : ''}.`);
  }
  if (result.failed?.length) parts.push(`${plural(result.failed.length, 'request')} could not be refreshed.`);
  return parts.join(' ');
}

// Every request mutation the UI performs. Simple field edits apply to the
// table immediately and reconcile with the server in the background.
export function useRequestActions({ data, toasts, categories }) {
  const { refreshRequests, refreshRequestsById, removeRequestsLocally, refreshStats, refreshCatalogs, patchRequestsLocally } = data;
  const { showToast, updateToast, dismissToast } = toasts;
  const [pendingDeleteIds, setPendingDeleteIds] = useState(() => new Set());
  const [isDateRefreshRunning, setIsDateRefreshRunning] = useState(false);
  const pendingDeletesRef = useRef(new Map());

  // Bring changed rows (or everything, without ids) back in line with the server.
  const reconcile = useCallback(({ ids = null, catalogs = false } = {}) => {
    if (ids) void refreshRequestsById(ids);
    else void refreshRequests();
    void refreshStats();
    if (catalogs) void refreshCatalogs();
  }, [refreshCatalogs, refreshRequests, refreshRequestsById, refreshStats]);

  const createRequest = useCallback(async (payload) => {
    try {
      const result = await api.post('/api/requests', payload);
      const requestId = result?.id ?? result?.requestId ?? null;
      if (requestId) await refreshRequestsById([requestId]);
      reconcile({ ids: requestId ? [] : null, catalogs: true });
      return { ok: true, requestId };
    } catch (error) {
      if (error.status === 409) {
        return { ok: false, reason: 'duplicate', requestId: error.data?.requestId, message: error.data?.message || error.message };
      }
      if (error.code === 'BEATMAPSET_NOT_FOUND') {
        return { ok: false, reason: 'missing-beatmap', message: error.message };
      }
      return { ok: false, reason: 'error', message: error.message };
    }
  }, [reconcile, refreshRequestsById]);

  const addCategoriesToExisting = useCallback(async (requestId, categoryPayload) => {
    try {
      await api.post('/api/requests', { add_to_existing_id: requestId, categories: categoryPayload });
      await refreshRequestsById([requestId]);
      reconcile({ ids: [] });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }, [reconcile, refreshRequestsById]);

  // quiet: inline table edits show no success toast and update instantly.
  const updateRequest = useCallback(async (id, payload, { quiet = false } = {}) => {
    const instantFields = ['request_status', 'priority', 'deadline', 'notes'];
    const instantPatch = Object.fromEntries(Object.entries(payload).filter(([key]) => instantFields.includes(key)));
    if (Object.keys(instantPatch).length) patchRequestsLocally([id], instantPatch);
    try {
      await api.patch(`/api/requests/${id}`, payload);
      if (!quiet) showToast('Changes saved.', 'success', { duration: 2500 });
      reconcile({ ids: [id], catalogs: 'tags' in payload || 'categories' in payload });
      return true;
    } catch (error) {
      showToast(`Could not save the request: ${error.message}`, 'error');
      void refreshRequestsById([id]);
      return false;
    }
  }, [patchRequestsLocally, reconcile, refreshRequestsById, showToast]);

  const linkManualRequest = useCallback(async (id, link) => {
    try {
      const result = await api.post(`/api/requests/${id}/link-beatmap`, { link });
      await refreshRequestsById([id]);
      reconcile({ ids: [] });
      showToast(result?.message || 'Linked to osu!.', 'success');
      return { ok: true, beatmapsetId: result?.beatmapset_id };
    } catch (error) {
      showToast(error.message || 'Could not link this request to osu!.', 'error');
      return { ok: false, duplicateRequestId: error.data?.requestId };
    }
  }, [reconcile, refreshRequestsById, showToast]);

  const changeMapset = useCallback(async (id, link) => {
    try {
      const result = await api.post(`/api/requests/${id}/change-mapset`, { link });
      await refreshRequestsById([id]);
      reconcile({ ids: [] });
      const preserved = result?.guest_difficulties_preserved_as_manual || 0;
      showToast(`${result?.message || 'Beatmapset changed.'}${preserved ? ` Kept ${plural(preserved, 'guest difficulty', 'guest difficulties')} as manual entries.` : ''}`, 'success');
      return { ok: true, beatmapsetId: result?.beatmapset_id };
    } catch (error) {
      showToast(error.message || 'Could not change the beatmapset.', 'error');
      return { ok: false, duplicateRequestId: error.data?.requestId };
    }
  }, [reconcile, refreshRequestsById, showToast]);

  // Returns the refreshed difficulty list for the request drawer.
  const refreshBeatmap = useCallback(async (beatmapsetId, requestId = null) => {
    try {
      await api.post('/api/beatmaps/refresh', { beatmapset_id: beatmapsetId });
      const beatmap = await api.get(`/api/beatmaps/${beatmapsetId}?cacheOnly=1`).catch(() => null);
      await (requestId ? refreshRequestsById([requestId]) : refreshRequests());
      showToast('Beatmap details updated from osu!.', 'success', { duration: 2500 });
      return beatmap?.difficulties || null;
    } catch (error) {
      showToast(error.message || 'Could not refresh the beatmap from osu!.', 'error');
      return null;
    }
  }, [refreshRequests, refreshRequestsById, showToast]);

  const refreshRequestDate = useCallback(async (id) => {
    try {
      const result = await api.post(`/api/requests/${id}/refresh-date`);
      await refreshRequestsById([id]);
      showToast(result?.message || 'Date updated from osu!.', 'success', { duration: 2500 });
      return result?.added_date || null;
    } catch (error) {
      showToast(error.message || 'Could not refresh the date.', 'error');
      return null;
    }
  }, [refreshRequestsById, showToast]);

  // Deletes wait a few seconds so they can be undone from the toast.
  const commitDelete = useCallback(async (key, { keepalive = false } = {}) => {
    const pending = pendingDeletesRef.current.get(key);
    if (!pending) return;
    pendingDeletesRef.current.delete(key);
    window.clearTimeout(pending.timer);
    try {
      for (const batch of batches(pending.ids)) {
        await api.delete('/api/requests/bulk', { ids: batch }, { keepalive });
      }
    } catch (error) {
      showToast(`Some requests could not be deleted: ${error.message}`, 'error');
    } finally {
      if (!keepalive) {
        removeRequestsLocally(pending.ids);
        setPendingDeleteIds(current => {
          const next = new Set(current);
          pending.ids.forEach(id => next.delete(id));
          return next;
        });
        void refreshStats();
      }
    }
  }, [removeRequestsLocally, refreshStats, showToast]);

  const deleteRequests = useCallback((ids, label) => {
    if (!ids.length) return;
    const key = `delete-${Date.now()}-${ids[0]}`;
    setPendingDeleteIds(current => new Set([...current, ...ids]));
    const timer = window.setTimeout(() => void commitDelete(key), UNDO_DELETE_MS);
    pendingDeletesRef.current.set(key, { ids, timer });
    showToast(`Deleted ${label || plural(ids.length, 'request')}.`, 'info', {
      id: key,
      duration: UNDO_DELETE_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingDeletesRef.current.get(key);
          if (!pending) return;
          window.clearTimeout(pending.timer);
          pendingDeletesRef.current.delete(key);
          setPendingDeleteIds(current => {
            const next = new Set(current);
            ids.forEach(id => next.delete(id));
            return next;
          });
        },
      },
    });
  }, [commitDelete, showToast]);

  useEffect(() => {
    const flushDeletes = () => {
      for (const key of [...pendingDeletesRef.current.keys()]) void commitDelete(key, { keepalive: true });
    };
    window.addEventListener('pagehide', flushDeletes);
    return () => window.removeEventListener('pagehide', flushDeletes);
  }, [commitDelete]);

  const runBulkPatch = useCallback(async (ids, body, { localPatch, success, failure, catalogs = false }) => {
    if (!ids.length) return false;
    if (localPatch) patchRequestsLocally(ids, localPatch);
    const progressId = ids.length > BULK_BATCH_SIZE ? `bulk-${Date.now()}` : null;
    let done = 0;
    let failed = 0;
    let lastError = null;
    if (progressId) showToast(`Updating 0 of ${ids.length} requests…`, 'progress', { id: progressId, progress: { completed: 0, total: ids.length } });
    for (const batch of batches(ids)) {
      try {
        await api.patch('/api/requests/bulk', { ...body, ids: batch });
      } catch (error) {
        failed += batch.length;
        lastError = error;
      }
      done += batch.length;
      if (progressId) updateToast(progressId, { message: `Updating ${done} of ${ids.length} requests…`, progress: { completed: done, total: ids.length } });
    }
    if (progressId) dismissToast(progressId);
    reconcile({ ids, catalogs });
    if (failed) {
      showToast(`${failure} ${failed} of ${ids.length} failed${lastError ? `: ${lastError.message}` : '.'}`, 'error');
      return false;
    }
    showToast(success, 'success', { duration: 3000 });
    return true;
  }, [dismissToast, patchRequestsLocally, reconcile, showToast, updateToast]);

  const bulkSetStatus = useCallback((ids, status) => runBulkPatch(ids, { request_status: status }, {
    localPatch: { request_status: status },
    success: `Marked ${plural(ids.length, 'request')} as ${status}.`,
    failure: 'Could not update every status.',
  }), [runBulkPatch]);

  const bulkSetPriority = useCallback((ids, priority) => runBulkPatch(ids, { priority }, {
    localPatch: { priority },
    success: `Set ${plural(ids.length, 'request')} to ${priority} priority.`,
    failure: 'Could not update every priority.',
  }), [runBulkPatch]);

  const bulkSetCategory = useCallback((ids, categoryId, mode) => {
    const category = categories.find(item => item.id === Number(categoryId));
    if (!category) return Promise.resolve(false);
    return runBulkPatch(ids, { categoryId: category.id, mode }, {
      success: mode === 'move'
        ? `Moved ${plural(ids.length, 'request')} to ${category.name}.`
        : `Added ${plural(ids.length, 'request')} to ${category.name}.`,
      failure: 'Could not update every category.',
    });
  }, [categories, runBulkPatch]);

  const bulkAddTags = useCallback((ids, tagNames) => runBulkPatch(ids, { add_tags: tagNames }, {
    localPatch: request => ({ tags: [...new Set([...(request.tags || []), ...tagNames])] }),
    success: `Tagged ${plural(ids.length, 'request')}.`,
    failure: 'Could not tag every request.',
    catalogs: true,
  }), [runBulkPatch]);

  // ids = null refreshes every osu!-linked request.
  const refreshDates = useCallback(async (ids = null) => {
    if (isDateRefreshRunning) {
      showToast('A date refresh is already running.', 'warning');
      return false;
    }
    setIsDateRefreshRunning(true);
    const progressId = `refresh-dates-${Date.now()}`;
    try {
      let status = await api.post('/api/requests/refresh-dates', ids ? { ids } : {});
      if (!status?.completed && status?.jobId) {
        showToast(`Refreshing 0 of ${status.total} dates from osu!…`, 'progress', { id: progressId, progress: { completed: 0, total: status.total } });
        while (status.status !== 'completed') {
          await new Promise(resolve => window.setTimeout(resolve, JOB_POLL_MS));
          status = await api.get(`/api/requests/refresh-dates/status/${status.jobId}`);
          updateToast(progressId, { message: `Refreshing ${status.processed} of ${status.total} dates from osu!…`, progress: { completed: status.processed, total: status.total } });
        }
        dismissToast(progressId);
      }
      const result = status?.result || {};
      reconcile();
      const hasWarnings = result.skippedManual?.length || result.skippedNoUsableDate?.length || result.failed?.length;
      showToast(status?.message && !status.result ? status.message : summarizeDateRefresh(result), hasWarnings ? 'warning' : 'success', { duration: hasWarnings ? 9000 : 4000 });
      return true;
    } catch (error) {
      dismissToast(progressId);
      showToast(error.message || 'Could not refresh dates from osu!.', 'error');
      return false;
    } finally {
      setIsDateRefreshRunning(false);
    }
  }, [dismissToast, isDateRefreshRunning, reconcile, showToast, updateToast]);

  const importBeatmapLinks = useCallback(async (linksText, categoryNames) => {
    try {
      const result = await api.post('/api/migration/import-beatmap-links', { linksText, categories: categoryNames }, { timeoutMs: 600000 });
      await refreshRequests();
      reconcile({ catalogs: true });
      showToast(result?.message || 'Links imported.', result?.apiFailures ? 'warning' : 'success');
      return true;
    } catch (error) {
      showToast(`Could not import the links: ${error.message}`, 'error');
      return false;
    }
  }, [reconcile, refreshRequests, showToast]);

  return useMemo(() => ({
    pendingDeleteIds,
    isDateRefreshRunning,
    createRequest,
    addCategoriesToExisting,
    updateRequest,
    linkManualRequest,
    changeMapset,
    refreshBeatmap,
    refreshRequestDate,
    deleteRequests,
    bulkSetStatus,
    bulkSetPriority,
    bulkSetCategory,
    bulkAddTags,
    refreshDates,
    importBeatmapLinks,
  }), [
    addCategoriesToExisting, bulkAddTags, bulkSetCategory, bulkSetPriority, bulkSetStatus, changeMapset, createRequest,
    deleteRequests, importBeatmapLinks, isDateRefreshRunning, linkManualRequest, pendingDeleteIds, refreshBeatmap,
    refreshDates, refreshRequestDate, updateRequest,
  ]);
}
