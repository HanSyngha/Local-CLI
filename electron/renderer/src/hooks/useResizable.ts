/**
 * useResizable Hook
 *      
 * - localStorage  
 * -      
 * - 60fps  
 * -   
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface ResizableConfig {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  direction: 'horizontal' | 'vertical';
  useRatio?: boolean;
  initialCollapsed?: boolean;
}

export interface ResizableState {
  size: number;
  isResizing: boolean;
  isCollapsed: boolean;
}

export interface ResizableActions {
  startResize: (e: React.MouseEvent) => void;
  setSize: (size: number) => void;
  collapse: () => void;
  expand: () => void;
  toggle: () => void;
  resetToDefault: () => void;
}

export interface UseResizableReturn extends ResizableState, ResizableActions {
  resizeHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
    onDoubleClick: () => void;
  };
}

// localStorage 
const getStoredSize = (key: string, defaultValue: number): number => {
  try {
    const stored = localStorage.getItem(`resizable-${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      return typeof parsed.size === 'number' ? parsed.size : defaultValue;
    }
  } catch {
    // 
  }
  return defaultValue;
};

const getStoredCollapsed = (key: string): boolean => {
  try {
    const stored = localStorage.getItem(`resizable-${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      return typeof parsed.collapsed === 'boolean' ? parsed.collapsed : false;
    }
  } catch {
    // 
  }
  return false;
};

const saveToStorage = (key: string, size: number, collapsed: boolean): void => {
  try {
    localStorage.setItem(`resizable-${key}`, JSON.stringify({ size, collapsed }));
  } catch {
    // 
  }
};

export function useResizable(config: ResizableConfig): UseResizableReturn {
  const { storageKey, defaultSize, minSize, maxSize, direction, useRatio = false, initialCollapsed } = config;

  const [size, setSizeState] = useState(() => getStoredSize(storageKey, defaultSize));
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() =>
    initialCollapsed !== undefined ? initialCollapsed : getStoredCollapsed(storageKey)
  );

  // Refs for values needed during resize (to avoid stale closures)
  const configRef = useRef({ minSize, maxSize, direction, useRatio, storageKey });
  const sizeRef = useRef(size);
  const isCollapsedRef = useRef(isCollapsed);
  const rafRef = useRef<number | null>(null);
  const startPosRef = useRef<number>(0);
  const startSizeRef = useRef<number>(0);
  const containerSizeRef = useRef<number>(0);

  // Keep refs updated
  useEffect(() => {
    configRef.current = { minSize, maxSize, direction, useRatio, storageKey };
  }, [minSize, maxSize, direction, useRatio, storageKey]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  //  
  const setSize = useCallback((newSize: number) => {
    const { minSize: min, maxSize: max, storageKey: key } = configRef.current;
    const clampedSize = Math.max(min, Math.min(max, newSize));
    setSizeState(clampedSize);
    saveToStorage(key, clampedSize, isCollapsedRef.current);
  }, []);

  // /
  const collapse = useCallback(() => {
    setIsCollapsed(true);
    saveToStorage(configRef.current.storageKey, sizeRef.current, true);
  }, []);

  const expand = useCallback(() => {
    setIsCollapsed(false);
    saveToStorage(configRef.current.storageKey, sizeRef.current, false);
  }, []);

  const toggle = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev;
      saveToStorage(configRef.current.storageKey, sizeRef.current, newValue);
      return newValue;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setSizeState(defaultSize);
    saveToStorage(configRef.current.storageKey, defaultSize, isCollapsedRef.current);
  }, [defaultSize]);

  //   ()
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const { direction: dir, minSize: min, maxSize: max, useRatio: ratio, storageKey: key } = configRef.current;

    startPosRef.current = dir === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = sizeRef.current;
    containerSizeRef.current = dir === 'horizontal' ? window.innerWidth : window.innerHeight;

    setIsResizing(true);
    document.body.style.cursor = dir === 'horizontal' ? 'ew-resize' : 'ns-resize';
    document.body.style.userSelect = 'none';
    document.documentElement.classList.add('is-resizing');
    document.documentElement.setAttribute('data-resize-direction', dir);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const clientPos = dir === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
        const delta = clientPos - startPosRef.current;

        let newSize: number;
        if (dir === 'vertical') {
          newSize = startSizeRef.current - delta;
        } else {
          newSize = startSizeRef.current + delta;
        }

        if (ratio && containerSizeRef.current > 0) {
          const maxRatio = 0.8;
          const minRatio = 0.1;
          const ratioBasedMax = containerSizeRef.current * maxRatio;
          const ratioBasedMin = containerSizeRef.current * minRatio;
          newSize = Math.max(ratioBasedMin, Math.min(ratioBasedMax, newSize));
        }

        newSize = Math.max(min, Math.min(max, newSize));
        setSizeState(newSize);
      });
    };

    const handleMouseUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.documentElement.classList.remove('is-resizing');
      document.documentElement.removeAttribute('data-resize-direction');

      // Save final size
      setSizeState(currentSize => {
        saveToStorage(key, currentSize, isCollapsedRef.current);
        return currentSize;
      });

      // Remove listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  //   ()
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;

    const { direction: dir, minSize: min, maxSize: max, useRatio: ratio, storageKey: key } = configRef.current;

    startPosRef.current = dir === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY;
    startSizeRef.current = sizeRef.current;
    containerSizeRef.current = dir === 'horizontal' ? window.innerWidth : window.innerHeight;

    setIsResizing(true);
    document.documentElement.classList.add('is-resizing');
    document.documentElement.setAttribute('data-resize-direction', dir);

    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (moveEvent.touches.length !== 1) return;
      moveEvent.preventDefault();

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const clientPos = dir === 'horizontal' ? moveEvent.touches[0].clientX : moveEvent.touches[0].clientY;
        const delta = clientPos - startPosRef.current;

        let newSize: number;
        if (dir === 'vertical') {
          newSize = startSizeRef.current - delta;
        } else {
          newSize = startSizeRef.current + delta;
        }

        if (ratio && containerSizeRef.current > 0) {
          const maxRatio = 0.8;
          const minRatio = 0.1;
          const ratioBasedMax = containerSizeRef.current * maxRatio;
          const ratioBasedMin = containerSizeRef.current * minRatio;
          newSize = Math.max(ratioBasedMin, Math.min(ratioBasedMax, newSize));
        }

        newSize = Math.max(min, Math.min(max, newSize));
        setSizeState(newSize);
      });
    };

    const handleTouchEnd = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      setIsResizing(false);
      document.documentElement.classList.remove('is-resizing');
      document.documentElement.removeAttribute('data-resize-direction');

      setSizeState(currentSize => {
        saveToStorage(key, currentSize, isCollapsedRef.current);
        return currentSize;
      });

      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
  }, []);

  //      
  useEffect(() => {
    if (!useRatio) return;

    const handleResize = () => {
      const containerSize = direction === 'horizontal' ? window.innerWidth : window.innerHeight;
      if (containerSizeRef.current > 0) {
        const ratio = sizeRef.current / containerSizeRef.current;
        const newSize = Math.max(minSize, Math.min(maxSize, containerSize * ratio));
        setSizeState(newSize);
      }
      containerSizeRef.current = containerSize;
    };

    containerSizeRef.current = direction === 'horizontal' ? window.innerWidth : window.innerHeight;

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [useRatio, direction, minSize, maxSize]);

  return {
    size,
    isResizing,
    isCollapsed,
    startResize: handleMouseDown,
    setSize,
    collapse,
    expand,
    toggle,
    resetToDefault,
    resizeHandleProps: {
      onMouseDown: handleMouseDown,
      onTouchStart: handleTouchStart,
      onDoubleClick: resetToDefault,
    },
  };
}

export default useResizable;
