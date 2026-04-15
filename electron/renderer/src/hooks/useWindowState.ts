/**
 * useWindowState Hook
 *    
 * -  / 
 * -   
 * -   won
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
  displayId?: number;
}

export interface UseWindowStateReturn {
  /**    */
  state: WindowState;
  /**   */
  isMaximized: boolean;
  /**   */
  isMinimized: boolean;
  /**   */
  isFullScreen: boolean;
  /**   */
  windowSize: { width: number; height: number };
  /**   */
  windowPosition: { x: number; y: number };
  /**   */
  saveState: () => void;
  /**  won */
  restoreState: () => void;
  /**    */
  resetState: () => void;
}

const STORAGE_KEY = 'window-state';

//   
const getDefaultState = (): WindowState => ({
  bounds: {
    x: Math.round((screen.width - 1200) / 2),
    y: Math.round((screen.height - 800) / 2),
    width: 1200,
    height: 800,
  },
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
});

// localStorage  
const loadState = (): WindowState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      //  
      if (
        parsed.bounds &&
        typeof parsed.bounds.x === 'number' &&
        typeof parsed.bounds.y === 'number' &&
        typeof parsed.bounds.width === 'number' &&
        typeof parsed.bounds.height === 'number'
      ) {
        return parsed;
      }
    }
  } catch {
    // 
  }
  return null;
};

// localStorage  
const saveStateToStorage = (state: WindowState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 
  }
};

//     
const isWindowInBounds = (bounds: WindowBounds): boolean => {
  const { x, y, width, height } = bounds;

  //      
  const minVisible = 100;

  return (
    x + width > minVisible &&
    y + height > minVisible &&
    x < screen.width - minVisible &&
    y < screen.height - minVisible
  );
};

//    (  )
const normalizeWindowBounds = (bounds: WindowBounds): WindowBounds => {
  if (isWindowInBounds(bounds)) {
    return bounds;
  }

  //   
  return {
    ...bounds,
    x: Math.round((screen.width - bounds.width) / 2),
    y: Math.round((screen.height - bounds.height) / 2),
  };
};

export function useWindowState(): UseWindowStateReturn {
  //   
  const [state, setState] = useState<WindowState>(() => {
    const saved = loadState();
    if (saved) {
      return {
        ...saved,
        bounds: normalizeWindowBounds(saved.bounds),
      };
    }
    return getDefaultState();
  });

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  //   / 
  useEffect(() => {
    const handleResize = () => {
      // /     
      if (!state.isMaximized && !state.isFullScreen) {
        setState(prev => ({
          ...prev,
          bounds: {
            ...prev.bounds,
            width: window.innerWidth,
            height: window.innerHeight,
          },
        }));
      }
    };

    //  
    const debouncedSave = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveStateToStorage(state);
      }, 500);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('resize', debouncedSave);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', debouncedSave);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state.isMaximized, state.isFullScreen]);

  // Electron API integration
  useEffect(() => {
    const { electronAPI } = window;
    if (!electronAPI?.window) return;

    //    
    const unsubMaximize = electronAPI.window.onMaximizeChange?.((isMaximized: boolean) => {
      setState(prev => ({ ...prev, isMaximized }));
    });

    //    
    electronAPI.window.isMaximized?.().then((isMaximized: boolean) => {
      setState(prev => ({ ...prev, isMaximized }));
    });

    return () => {
      unsubMaximize?.();
    };
  }, []);

  //  
  const saveState = useCallback(() => {
    saveStateToStorage(state);
  }, [state]);

  //  won
  const restoreState = useCallback(() => {
    const saved = loadState();
    if (saved) {
      setState({
        ...saved,
        bounds: normalizeWindowBounds(saved.bounds),
      });
    }
  }, []);

  //   
  const resetState = useCallback(() => {
    const defaultState = getDefaultState();
    setState(defaultState);
    saveStateToStorage(defaultState);
  }, []);

  return {
    state,
    isMaximized: state.isMaximized,
    isMinimized: state.isMinimized,
    isFullScreen: state.isFullScreen,
    windowSize: {
      width: state.bounds.width,
      height: state.bounds.height,
    },
    windowPosition: {
      x: state.bounds.x,
      y: state.bounds.y,
    },
    saveState,
    restoreState,
    resetState,
  };
}

export default useWindowState;
