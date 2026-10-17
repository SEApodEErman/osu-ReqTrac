import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  density: 'comfortable',
  sidebarCollapsed: false,
  clipboardDetection: true,
  setupDismissed: false,
  // Per-view table layout and filters, keyed by 'all' or a category ID.
  columns: {},
  views: {},
  // Category IDs ticked on the last request that was added.
  lastCategories: null,
};

const SAVE_DELAY_MS = 400;

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is only a startup cache for the theme.
  }
}

// Earlier versions kept preferences in localStorage, which the packaged app
// lost whenever its local port changed. Carry over whatever is still there.
function legacyPreferences() {
  const migrated = {};
  const theme = readLocalStorage('theme');
  if (['light', 'dark', 'system'].includes(theme)) migrated.theme = theme;
  try {
    const lastCategories = JSON.parse(readLocalStorage('lastRequestCategories') || 'null');
    if (lastCategories && typeof lastCategories === 'object') migrated.lastCategories = lastCategories;
  } catch {
    // Ignore unreadable legacy values.
  }
  const columns = {};
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      const match = key?.match(/^request-columns:([^:]+)$/);
      if (!match) continue;
      const visible = JSON.parse(readLocalStorage(key) || 'null');
      const order = JSON.parse(readLocalStorage(`${key}:order`) || 'null');
      if (Array.isArray(visible)) columns[match[1]] = { visible, ...(Array.isArray(order) ? { order } : {}) };
    }
  } catch {
    // Ignore unreadable legacy values.
  }
  if (Object.keys(columns).length) migrated.columns = columns;
  return migrated;
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(() => ({
    ...DEFAULT_PREFERENCES,
    theme: readLocalStorage('theme') || DEFAULT_PREFERENCES.theme,
  }));
  const [isLoaded, setIsLoaded] = useState(false);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const hydratedRef = useRef(false);

  const flush = useCallback((options = {}) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const updates = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(updates).length === 0) return;
    api.patch('/api/settings/preferences', updates, options).catch(error => {
      console.error('Failed to save preferences:', error);
    });
  }, []);

  const queueSave = useCallback((updates) => {
    Object.assign(pendingRef.current, updates);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => flush(), SAVE_DELAY_MS);
  }, [flush]);

  const hydrate = useCallback((serverPreferences) => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = serverPreferences && typeof serverPreferences === 'object' ? serverPreferences : {};
    const migration = stored.legacyMigrated ? {} : { ...legacyPreferences(), legacyMigrated: true };
    const merged = { ...DEFAULT_PREFERENCES, ...migration, ...stored };
    setPreferences(current => ({ ...merged, ...pendingRef.current, theme: pendingRef.current.theme || merged.theme || current.theme }));
    if (!stored.legacyMigrated) queueSave(migration);
    setIsLoaded(true);
  }, [queueSave]);

  const setPreference = useCallback((key, valueOrUpdater) => {
    setPreferences(current => {
      const value = typeof valueOrUpdater === 'function' ? valueOrUpdater(current[key]) : valueOrUpdater;
      if (Object.is(value, current[key])) return current;
      queueSave({ [key]: value });
      return { ...current, [key]: value };
    });
  }, [queueSave]);

  // Re-read after a restore or a delete-all, which replace the stored values.
  const reload = useCallback(async () => {
    try {
      const stored = await api.get('/api/settings/preferences');
      setPreferences({ ...DEFAULT_PREFERENCES, ...stored });
    } catch (error) {
      console.error('Failed to reload preferences:', error);
    }
  }, []);

  useEffect(() => {
    writeLocalStorage('theme', preferences.theme);
  }, [preferences.theme]);

  useEffect(() => {
    const saveBeforeClose = () => flush({ keepalive: true });
    window.addEventListener('pagehide', saveBeforeClose);
    return () => {
      window.removeEventListener('pagehide', saveBeforeClose);
      flush();
    };
  }, [flush]);

  return { preferences, isLoaded, hydrate, setPreference, reload };
}
