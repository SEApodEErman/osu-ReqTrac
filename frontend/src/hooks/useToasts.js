import { useCallback, useMemo, useRef, useState } from 'react';

const MAX_VISIBLE_TOASTS = 4;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextIdRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  // type: info | success | warning | error | progress
  // options: { action: { label, onClick }, duration (ms, 0 = stays), id, title }
  const showToast = useCallback((message, type = 'info', options = {}) => {
    const id = options.id ?? `toast-${++nextIdRef.current}`;
    const duration = options.duration ?? (type === 'progress' ? 0 : type === 'error' ? 8000 : 5000);
    const toast = { id, message, type, duration, title: options.title, action: options.action, progress: options.progress, createdAt: Date.now() };
    setToasts(current => {
      const others = current.filter(item => item.id !== id);
      return [...others, toast].slice(-MAX_VISIBLE_TOASTS);
    });
    if ((type === 'error' || type === 'warning') && window.electronAPI?.windowControls?.flashFrame) {
      void window.electronAPI.windowControls.flashFrame();
    }
    return id;
  }, []);

  const updateToast = useCallback((id, patch) => {
    setToasts(current => current.map(toast => (toast.id === id ? { ...toast, ...patch } : toast)));
  }, []);

  return useMemo(() => ({ toasts, showToast, updateToast, dismissToast }), [toasts, showToast, updateToast, dismissToast]);
}
