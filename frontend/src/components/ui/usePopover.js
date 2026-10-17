import { useCallback, useEffect, useRef, useState } from 'react';

// Open/close state for an anchored panel that closes on outside clicks and Escape.
export function usePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(open => !open), []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointer = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  return { isOpen, setIsOpen, open: () => setIsOpen(true), close, toggle, containerRef };
}
