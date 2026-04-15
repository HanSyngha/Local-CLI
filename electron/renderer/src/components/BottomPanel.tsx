/**
 * BottomPanel Component
 * Contains Terminal, Chat, and Logs panels with tab switching.
 * Chat tab header includes model selector, context usage, session controls,
 * and quick-access toolbar buttons (tools, usage, settings, help, info).
 */

import React, { memo, Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import type { Session, EndpointConfig } from '../../../preload/index';
import type { ChatPanelRef } from './ChatPanel';
import { useAgent } from '../contexts/AgentContext';
import ResizablePanel from './ResizablePanel';
import Terminal from './Terminal';
import ChatPanel from './ChatPanel';
import SessionTabBar, { type TabInfo } from './SessionTabBar';
import { useTranslation } from '../i18n/LanguageContext';

// Lazy loaded
const LogViewer = lazy(() => import('./LogViewer'));

type PanelLayout = 'terminal' | 'chat' | 'logs' | 'split';

interface CommandHandlers {
  onCompact: () => Promise<void>;
  onSettings: () => void;
  onTool: () => void;
  onUsage: () => void;
  onInfo: () => void;
}

interface BottomPanelProps {
  isOpen: boolean;
  layout: PanelLayout;
  isFullscreen: boolean;
  height: number;
  layoutState: {
    bottomPanelDefaultHeight: number;
    bottomPanelMinHeight: number;
    bottomPanelMaxHeight: number;
  };
  currentDirectory: string;
  currentSession: Session | null;
  allowAllPermissions: boolean;
  endpoints: EndpointConfig[];
  currentEndpointId: string | null;
  isModelDropdownOpen: boolean;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
  chatPanelRef: React.RefObject<ChatPanelRef | null>;
  commandHandlers: CommandHandlers;
  onLayoutChange: (layout: PanelLayout) => void;
  onFullscreenToggle: () => void;
  onHeightChange: (height: number) => void;
  onCollapse: () => void;
  onSessionChange: (session: Session | null) => void;
  onClearSession: () => void;
  onNewSession: () => void;
  onLoadSession: () => void;
  onAllowAllPermissionsChange: (value: boolean) => void;
  onModelDropdownToggle: () => void;
  currentModelId: string | null;
  onSelectModel: (endpointId: string, modelId?: string) => void;
  autoFileView: boolean;
  onAutoFileViewChange: (value: boolean) => void;
  onCommandPalette: () => void;
  onToggleTaskWindow: () => void;
  onChangeDirectory: () => void;
  // Multi-tab props
  openTabs?: Array<{
    sessionId: string;
    session: Session;
    name: string;
    isRunning: boolean;
    hasUnread: boolean;
    allowAllPermissions: boolean;
    chatPanelRef: React.RefObject<ChatPanelRef | null>;
  }>;
  activeTabId?: string | null;
  tabInfos?: TabInfo[];
  onSwitchTab?: (sessionId: string) => void;
  onCloseTab?: (sessionId: string) => void;
  onRenameTab?: (sessionId: string, name: string) => void;
  onClearTab?: (sessionId: string) => void;
}

const BottomPanel: React.FC<BottomPanelProps> = ({
  isOpen,
  layout,
  isFullscreen,
  height: _height,
  layoutState,
  currentDirectory,
  currentSession,
  allowAllPermissions,
  endpoints,
  currentEndpointId,
  isModelDropdownOpen,
  modelDropdownRef,
  chatPanelRef,
  commandHandlers,
  onLayoutChange,
  onFullscreenToggle,
  onHeightChange,
  onCollapse,
  onSessionChange,
  onClearSession,
  onNewSession,
  onLoadSession,
  onAllowAllPermissionsChange,
  currentModelId,
  onModelDropdownToggle,
  onSelectModel,
  autoFileView,
  onAutoFileViewChange,
  onCommandPalette,
  onToggleTaskWindow,
  onChangeDirectory,
  // Multi-tab
  openTabs,
  activeTabId,
  tabInfos,
  onSwitchTab,
  onCloseTab,
  onRenameTab,
  onClearTab,
}) => {
  const { t } = useTranslation();
  const { clearSessionCache } = useAgent();

  // Wrap onCloseTab to also clear AgentContext cache for the closed session
  const handleCloseTabWithCleanup = useCallback((sessionId: string) => {
    clearSessionCache(sessionId);
    contextUsageCacheRef.current.delete(sessionId);
    onCloseTab?.(sessionId);
  }, [clearSessionCache, onCloseTab]);

  // Context usage from agent IPC — per-session cache
  const [contextUsage, setContextUsage] = useState<number>(0);
  const contextUsageCacheRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!window.electronAPI?.agent?.onContextUpdate) return;

    const unsub = window.electronAPI.agent.onContextUpdate((data) => {
      const eventSessionId = (data as any).sessionId as string | undefined;
      if (eventSessionId) {
        contextUsageCacheRef.current.set(eventSessionId, data.usagePercentage);
      }
      // Only update displayed value if event is for the active tab (or no sessionId = legacy)
      if (!eventSessionId || eventSessionId === activeTabId) {
        setContextUsage(data.usagePercentage);
      }
    });

    return () => unsub();
  }, [activeTabId]);

  // Restore cached context usage when switching tabs
  useEffect(() => {
    if (activeTabId) {
      setContextUsage(contextUsageCacheRef.current.get(activeTabId) ?? 0);
    }
  }, [activeTabId]);


  if (!isOpen) return null;

  const currentEndpoint = endpoints.find(e => e.id === currentEndpointId);
  const currentModel = currentEndpoint?.models?.find(m => m.id === currentModelId) || currentEndpoint?.models?.[0];
  const currentModelName = currentModel?.name || currentEndpoint?.name || t('model.noModel');

  // Check if any VL model exists across all endpoints
  const hasVisionModel = endpoints.some(ep =>
    ep.models?.some(m => m.supportsVision && m.enabled)
  );

  return (
    <div
      className={`bottom-panel-wrapper ${isFullscreen ? 'fullscreen' : ''}`}
      style={isFullscreen ? { height: '100%' } : undefined}
    >
      <ResizablePanel
        id="bottom-panel"
        direction="bottom"
        defaultSize={isFullscreen ? 99999 : layoutState.bottomPanelDefaultHeight}
        minSize={isFullscreen ? 99999 : layoutState.bottomPanelMinHeight}
        maxSize={isFullscreen ? 99999 : layoutState.bottomPanelMaxHeight}
        showCollapseButton={!isFullscreen}
        onSizeChange={isFullscreen ? undefined : onHeightChange}
        onCollapsedChange={(collapsed) => {
          if (collapsed && !isFullscreen) onCollapse();
        }}
        header={
          <div className="panel-header-rows">
            {/* Row 1: Tabs + Model + Context */}
            <div className="panel-header-row1">
              <div className="panel-tabs">
                <button
                  className={`panel-tab ${layout === 'chat' ? 'active' : ''}`}
                  onClick={() => onLayoutChange('chat')}
                  title={t('tab.chat.title')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                  </svg>
                  {t('tab.chat')}
                </button>
                <button
                  className={`panel-tab ${layout === 'terminal' ? 'active' : ''}`}
                  onClick={() => onLayoutChange('terminal')}
                  title={t('tab.terminal.title')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z"/>
                  </svg>
                  {t('tab.terminal')}
                </button>
                <button
                  className={`panel-tab ${layout === 'logs' ? 'active' : ''}`}
                  onClick={() => onLayoutChange('logs')}
                  title={t('tab.logs.title')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                    <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
                  </svg>
                  {t('tab.logs')}
                </button>
              </div>

              <div className="panel-header-row1-right">
                {/* Vision indicator - shown when any VL model exists */}
                {hasVisionModel && (
                  <span className="vision-badge" title="Vision Language Model available">Vision</span>
                )}
                {/* Model Selector - only when Chat active */}
                {layout === 'chat' && (
                  <div className="panel-model-selector" ref={modelDropdownRef}>
                    <button
                      className="panel-toolbar-btn panel-model-btn"
                      onClick={onModelDropdownToggle}
                      data-tooltip={t('toolbar.changeModel')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"/>
                      </svg>
                      <span className="panel-model-name">{currentModelName}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="dropdown-arrow">
                        <path d="M7 10l5 5 5-5z"/>
                      </svg>
                    </button>
                    {isModelDropdownOpen && (
                      <div className="panel-model-dropdown">
                        {!currentEndpoint || currentEndpoint.models.length === 0 ? (
                          <div className="panel-model-empty">
                            <span>{t('model.noModels')}</span>
                            <button onClick={() => { onModelDropdownToggle(); commandHandlers.onSettings(); }}>
                              {t('model.openSettings')}
                            </button>
                          </div>
                        ) : (
                          endpoints.flatMap(endpoint =>
                            endpoint.models.map(model => (
                              <button
                                key={`${endpoint.id}-${model.id}`}
                                className={`panel-model-item ${endpoint.id === currentEndpointId && model.id === currentModelId ? 'active' : ''}`}
                                onClick={() => onSelectModel(endpoint.id, model.id)}
                              >
                                <span>{model.name}</span>
                                {endpoint.id === currentEndpointId && model.id === currentModelId && (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                  </svg>
                                )}
                              </button>
                            ))
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Context Usage - only when Chat active */}
                {layout === 'chat' && (
                  <div
                    className={`panel-context-usage ${contextUsage > 80 ? 'critical' : contextUsage > 60 ? 'warning' : ''}`}
                    title={`Context: ${contextUsage}% used (auto-compact at 70%)`}
                  >
                    <span className="panel-context-label">{t('model.context')}</span>
                    <div className="panel-context-bar">
                      <div
                        className="panel-context-bar-fill"
                        style={{
                          width: `${Math.max(contextUsage, 2)}%`,
                          background: contextUsage > 80 ? '#EF4444' : contextUsage > 60 ? '#F59E0B' : '#10B981'
                        }}
                      />
                    </div>
                    <span className="panel-context-percent">{contextUsage}%</span>
                  </div>
                )}

                {/* Fullscreen toggle */}
                {!isFullscreen && (
                  <button
                    className="panel-fullscreen-btn"
                    onClick={onFullscreenToggle}
                    title={t('toolbar.fullscreen')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                    </svg>
                  </button>
                )}

                {/* Auto File View Toggle (eye icon) */}
                {layout === 'chat' && (
                  <button
                    className={`panel-toolbar-btn panel-auto-view-btn ${autoFileView ? 'active' : ''}`}
                    onClick={() => onAutoFileViewChange(!autoFileView)}
                    data-tooltip={autoFileView ? t('toolbar.autoViewOn') : t('toolbar.autoViewOff')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      {autoFileView ? (
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      ) : (
                        <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                      )}
                    </svg>
                  </button>
                )}

                {/* Jarvis Toggle (robot icon) */}
                {layout === 'chat' && (
                  <JarvisToggleButton />
                )}

                {/* Compact - Row 1 far right */}
                {layout === 'chat' && (
                  <button className="panel-toolbar-btn" onClick={commandHandlers.onCompact} data-tooltip={t('toolbar.compact')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.41 18.59L8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zM16.59 5.41L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59zM5 11h14v2H5z"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Session Tabs (left) + Toolbar (right) - Chat tab only */}
            {layout === 'chat' && (
              <div className="panel-header-row2">
                {/* Left: Session Tab Bar */}
                {tabInfos && onSwitchTab && onCloseTab && onRenameTab && onClearTab ? (
                  <SessionTabBar
                    tabs={tabInfos}
                    activeTabId={activeTabId ?? null}
                    onSwitchTab={onSwitchTab}
                    onNewTab={onNewSession}
                    onCloseTab={handleCloseTabWithCleanup}
                    onRenameTab={onRenameTab}
                    onLoadSession={onLoadSession}
                    onClearTab={onClearTab}
                  />
                ) : (
                  /* Fallback: old-style buttons if no multi-tab props */
                  <div className="panel-toolbar-group">
                    <button className="panel-toolbar-btn" onClick={onNewSession} data-tooltip={t('toolbar.newSession')}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                    </button>
                    <button className="panel-toolbar-btn" onClick={onLoadSession} data-tooltip={t('toolbar.loadSession')}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
                      </svg>
                    </button>
                    <button className="panel-toolbar-btn" onClick={onClearSession} data-tooltip={t('toolbar.clearChat')}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                      </svg>
                    </button>
                  </div>
                )}

                <div className="panel-toolbar-spacer" />

                {/* Right: Tool/Usage/Settings/Info */}
                <div className="panel-toolbar-group">
                  <button className="panel-toolbar-btn" onClick={commandHandlers.onTool} data-tooltip={t('toolbar.toolSettings')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
                    </svg>
                  </button>
                  <button className="panel-toolbar-btn" onClick={commandHandlers.onUsage} data-tooltip={t('toolbar.tokenUsage')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>
                    </svg>
                  </button>
                  <button className="panel-toolbar-btn" onClick={commandHandlers.onSettings} data-tooltip={t('toolbar.settings')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                    </svg>
                  </button>
                  <button className="panel-toolbar-btn" onClick={commandHandlers.onInfo} data-tooltip={t('toolbar.about')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        }
        className="bottom-panel-container"
      >
        <div className="panel-content">
          {/* Keep all panels mounted to preserve state, hide with CSS */}
          <div className="panel-tab-content" style={{ display: layout === 'terminal' ? 'flex' : 'none' }}>
            <Terminal currentDirectory={currentDirectory} />
          </div>
          <div className="panel-tab-content" style={{ display: layout === 'chat' ? 'flex' : 'none' }}>
            {openTabs && openTabs.length > 0 ? (
              /* Multi-tab: render all ChatPanels, hide inactive ones */
              openTabs.map(tab => (
                <div
                  key={tab.sessionId}
                  className="session-chat-wrapper"
                  style={{ display: tab.sessionId === activeTabId ? 'flex' : 'none', flex: 1, minHeight: 0 }}
                >
                  <ChatPanel
                    ref={tab.chatPanelRef}
                    session={tab.session}
                    sessionId={tab.sessionId}
                    isActive={tab.sessionId === activeTabId}
                    onSessionChange={(session) => {
                      if (session) onSessionChange(session);
                    }}
                    onClearSession={onClearSession}
                    currentDirectory={currentDirectory}
                    onChangeDirectory={onChangeDirectory}
                    allowAllPermissions={tab.allowAllPermissions}
                    onAllowAllPermissionsChange={onAllowAllPermissionsChange}
                    hasVisionModel={hasVisionModel}
                  />
                </div>
              ))
            ) : (
              /* Single ChatPanel fallback */
              <ChatPanel
                ref={chatPanelRef}
                session={currentSession}
                onSessionChange={onSessionChange}
                onClearSession={onClearSession}
                currentDirectory={currentDirectory}
                onChangeDirectory={onChangeDirectory}
                allowAllPermissions={allowAllPermissions}
                onAllowAllPermissionsChange={onAllowAllPermissionsChange}
                hasVisionModel={hasVisionModel}
              />
            )}
          </div>
          <div className="panel-tab-content" style={{ display: layout === 'logs' ? 'flex' : 'none' }}>
            <Suspense fallback={<div className="loading-fallback">{t('chat.loadingLogs')}</div>}>
              <LogViewer isVisible={layout === 'logs'} currentSessionId={currentSession?.id || null} />
            </Suspense>
          </div>
        </div>
      </ResizablePanel>
    </div>
  );
};

// =============================================================================
// Jarvis Toggle Button (inline component)
// =============================================================================

const JarvisToggleButton: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.jarvis?.getConfig?.().then((config: { enabled: boolean }) => {
      setEnabled(config?.enabled ?? false);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleClick = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.jarvis) return;

    if (!enabled) {
      //  → 
      setEnabled(true);
      await api.jarvis.setConfig({ enabled: true });
      //    (startJarvisRuntime sync   )
      await new Promise(r => setTimeout(r, 300));
    }
    //  /
    await api.jarvis.showWindow();
  }, [enabled]);

  if (loading) return null;

  return (
    <button
      className={`panel-toolbar-btn panel-auto-view-btn jarvis-toolbar-btn ${enabled ? 'active' : ''}`}
      onClick={handleClick}
      data-tooltip={enabled ? 'Jarvis ' : 'Jarvis '}
      style={{
        position: 'relative',
        color: enabled ? '#D4A574' : undefined,
        background: enabled ? 'rgba(212, 165, 116, 0.15)' : undefined,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.07A7.001 7.001 0 0 1 14 23h-4a7.001 7.001 0 0 1-6.93-4H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zm-4 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
      </svg>
      {enabled && (
        <span style={{
          position: 'absolute', top: '1px', right: '1px',
          width: '6px', height: '6px', borderRadius: '50%',
          background: '#D4A574', border: '1px solid var(--color-bg-primary)',
        }} />
      )}
    </button>
  );
};

export default memo(BottomPanel);
