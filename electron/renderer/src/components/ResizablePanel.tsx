/**
 * ResizablePanel Component
 *     
 * - /  
 * -    won
 * -  /
 * - 60fps  
 * -   won
 */

import React, { useRef, useEffect } from 'react';
import { useResizable, type ResizableConfig } from '../hooks/useResizable';
import { useTranslation } from '../i18n/LanguageContext';
import './ResizablePanel.css';

export type ResizeDirection = 'left' | 'right' | 'top' | 'bottom';

export interface ResizablePanelProps {
  /**  ID () */
  id: string;
  /**   */
  children: React.ReactNode;
  /**   */
  direction: ResizeDirection;
  /**   (px) */
  defaultSize?: number;
  /**   (px) */
  minSize?: number;
  /**   (px) */
  maxSize?: number;
  /**    */
  collapsedSize?: number;
  /**    */
  defaultCollapsed?: boolean;
  /**     */
  showCollapseButton?: boolean;
  /**    */
  onSizeChange?: (size: number) => void;
  /** /   */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**   */
  className?: string;
  /**     */
  useRatio?: boolean;
  /**   */
  header?: React.ReactNode;
}

const ResizablePanel: React.FC<ResizablePanelProps> = ({
  id,
  children,
  direction,
  defaultSize = 300,
  minSize = 100,
  maxSize = 800,
  collapsedSize = 0,
  showCollapseButton = true,
  onSizeChange,
  onCollapsedChange,
  className = '',
  useRatio = false,
  header,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  //   orientation 
  const orientation: 'horizontal' | 'vertical' =
    direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';

  // useResizable  
  //  onCollapsedChange   visibility 
  //  expanded   (localStorage )
  const resizableConfig: ResizableConfig = {
    storageKey: `panel-${id}`,
    defaultSize,
    minSize,
    maxSize,
    direction: orientation,
    useRatio,
    initialCollapsed: onCollapsedChange ? false : undefined,
  };

  const {
    size,
    isResizing,
    isCollapsed,
    toggle,
    resetToDefault: _resetToDefault,
    resizeHandleProps,
  } = useResizable(resizableConfig);
  void _resetToDefault; // Suppress unused warning - available for future use

  //   
  useEffect(() => {
    onSizeChange?.(size);
  }, [size, onSizeChange]);

  // /   (     -    )
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onCollapsedChange?.(isCollapsed);
  }, [isCollapsed, onCollapsedChange]);

  //    
  const displaySize = isCollapsed ? collapsedSize : size;

  //  
  const panelStyle: React.CSSProperties = {
    [orientation === 'horizontal' ? 'width' : 'height']: displaySize,
    [orientation === 'horizontal' ? 'minWidth' : 'minHeight']: isCollapsed ? collapsedSize : minSize,
    [orientation === 'horizontal' ? 'maxWidth' : 'maxHeight']: isCollapsed ? collapsedSize : maxSize,
  };

  //    
  const handlePositionClass = `resize-handle-${direction}`;

  //   
  const getCollapseIcon = () => {
    if (isCollapsed) {
      //  
      switch (direction) {
        case 'left':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
          );
        case 'right':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 6l1.41 1.41L10.83 12l4.58 4.59L14 18l-6-6z" />
            </svg>
          );
        case 'top':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
            </svg>
          );
        case 'bottom':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
            </svg>
          );
      }
    } else {
      //  
      switch (direction) {
        case 'left':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 6l1.41 1.41L10.83 12l4.58 4.59L14 18l-6-6z" />
            </svg>
          );
        case 'right':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
          );
        case 'top':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
            </svg>
          );
        case 'bottom':
          return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
            </svg>
          );
      }
    }
  };

  return (
    <div
      ref={panelRef}
      className={`resizable-panel ${className} ${isResizing ? 'is-resizing' : ''} ${isCollapsed ? 'is-collapsed' : ''} resizable-panel-${direction}`}
      style={panelStyle}
      data-direction={direction}
    >
      {/*   () */}
      {(header || showCollapseButton) && (
        <div className="resizable-panel-header">
          <div className="resizable-panel-header-content">
            {header}
          </div>
          {showCollapseButton && (
            <button
              className="resizable-panel-collapse-btn"
              onClick={toggle}
              title={isCollapsed ? t('ui.expandPanel') : t('ui.collapsePanel')}
            >
              {getCollapseIcon()}
            </button>
          )}
        </div>
      )}

      {/*   */}
      <div className={`resizable-panel-content ${isCollapsed ? 'hidden' : ''}`}>
        {children}
      </div>

      {/*   */}
      {!isCollapsed && (
        <div
          className={`resize-handle ${handlePositionClass}`}
          {...resizeHandleProps}
          title={t('ui.resizeHint')}
        >
          <div className="resize-handle-indicator" />
        </div>
      )}
    </div>
  );
};

export default ResizablePanel;
