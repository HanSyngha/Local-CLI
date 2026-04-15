/**
 * useResponsive Hook
 *    
 * -  :   
 * -  :  
 * -  :  
 */

import { useState, useEffect, useMemo, useCallback } from 'react';

//  
export const BREAKPOINTS = {
  xs: 480,   //   
  sm: 640,   //  
  md: 768,   //  
  lg: 1024,  //  
  xl: 1280,  //   
  '2xl': 1536, //  
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

export interface ResponsiveState {
  /**    */
  width: number;
  /**    */
  height: number;
  /**   */
  breakpoint: BreakpointKey;
  /**     */
  shouldHideSidebar: boolean;
  /**     */
  useExpandedLayout: boolean;
  /**     */
  useCompactLayout: boolean;
  /**    */
  isMobile: boolean;
  /**    */
  isTablet: boolean;
  /**    */
  isDesktop: boolean;
}

export interface ResponsiveConfig {
  /**     */
  sidebarHideBreakpoint?: BreakpointKey;
  /**    */
  expandedBreakpoint?: BreakpointKey;
  /**    */
  compactBreakpoint?: BreakpointKey;
  /**   (ms) */
  debounceDelay?: number;
}

export interface UseResponsiveReturn extends ResponsiveState {
  /**    */
  isAbove: (breakpoint: BreakpointKey) => boolean;
  isBelow: (breakpoint: BreakpointKey) => boolean;
  isBetween: (min: BreakpointKey, max: BreakpointKey) => boolean;
  /**    */
  matches: (query: string) => boolean;
}

//   
const getCurrentBreakpoint = (width: number): BreakpointKey => {
  if (width < BREAKPOINTS.xs) return 'xs';
  if (width < BREAKPOINTS.sm) return 'sm';
  if (width < BREAKPOINTS.md) return 'md';
  if (width < BREAKPOINTS.lg) return 'lg';
  if (width < BREAKPOINTS.xl) return 'xl';
  return '2xl';
};

//  
const debounce = <T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
};

export function useResponsive(config: ResponsiveConfig = {}): UseResponsiveReturn {
  const {
    sidebarHideBreakpoint = 'md',
    expandedBreakpoint = 'xl',
    compactBreakpoint = 'sm',
    debounceDelay = 100,
  } = config;

  //  
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  //    
  useEffect(() => {
    const handleResize = debounce(() => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }, debounceDelay);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [debounceDelay]);

  //  
  const breakpoint = useMemo(
    () => getCurrentBreakpoint(dimensions.width),
    [dimensions.width]
  );

  //   
  const isAbove = useCallback(
    (bp: BreakpointKey): boolean => dimensions.width >= BREAKPOINTS[bp],
    [dimensions.width]
  );

  const isBelow = useCallback(
    (bp: BreakpointKey): boolean => dimensions.width < BREAKPOINTS[bp],
    [dimensions.width]
  );

  const isBetween = useCallback(
    (min: BreakpointKey, max: BreakpointKey): boolean =>
      dimensions.width >= BREAKPOINTS[min] && dimensions.width < BREAKPOINTS[max],
    [dimensions.width]
  );

  //   
  const matches = useCallback(
    (query: string): boolean => {
      if (typeof window === 'undefined') return false;
      return window.matchMedia(query).matches;
    },
    []
  );

  //  
  const state = useMemo<ResponsiveState>(() => {
    const { width, height } = dimensions;

    return {
      width,
      height,
      breakpoint,
      shouldHideSidebar: width < BREAKPOINTS[sidebarHideBreakpoint],
      useExpandedLayout: width >= BREAKPOINTS[expandedBreakpoint],
      useCompactLayout: width < BREAKPOINTS[compactBreakpoint],
      isMobile: width < BREAKPOINTS.md,
      isTablet: width >= BREAKPOINTS.md && width < BREAKPOINTS.lg,
      isDesktop: width >= BREAKPOINTS.lg,
    };
  }, [dimensions, breakpoint, sidebarHideBreakpoint, expandedBreakpoint, compactBreakpoint]);

  return {
    ...state,
    isAbove,
    isBelow,
    isBetween,
    matches,
  };
}

//    
export function useLayoutState() {
  const responsive = useResponsive();

  return useMemo(() => ({
    //  
    sidebarVisible: !responsive.shouldHideSidebar,
    sidebarDefaultWidth: responsive.useExpandedLayout ? 280 : 240,
    sidebarMinWidth: responsive.useCompactLayout ? 180 : 200,
    sidebarMaxWidth: responsive.useExpandedLayout ? 400 : 320,

    //  
    bottomPanelDefaultHeight: responsive.useCompactLayout ? 300 : 400,
    bottomPanelMinHeight: 150,
    bottomPanelMaxHeight: responsive.height * 0.8,

    rightPanelDefaultWidth: responsive.useExpandedLayout ? 400 : 320,
    rightPanelMinWidth: 280,
    rightPanelMaxWidth: responsive.width * 0.4,

    //  
    isCompact: responsive.useCompactLayout,
    isExpanded: responsive.useExpandedLayout,
    showBottomPanel: !responsive.useCompactLayout,
    showRightPanel: responsive.useExpandedLayout,

    //   
    minPaneSize: responsive.useCompactLayout ? 150 : 200,
    defaultSplitRatio: responsive.useExpandedLayout ? 0.6 : 0.5,
  }), [responsive]);
}

export default useResponsive;
