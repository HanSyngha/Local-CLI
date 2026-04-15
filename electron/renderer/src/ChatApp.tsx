/**
 * Local-CLI UI - Chat Window (Main)
 * Full chat functionality: LLM conversation, terminal, logs, session management.
 * No IDE features (editor, file explorer, sidebar removed).
 * Closing this window terminates the app.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, createRef } from 'react';
import type { ElectronAPI, Theme, Session, EndpointConfig } from '../../preload/index';
import './styles/global.css';
import './styles/App.css';

// Context providers
import { AgentProvider } from './contexts/AgentContext';
import { useTranslation } from './i18n/LanguageContext';

// Core components (always loaded)
import TitleBar from './components/TitleBar';
import type { ChatPanelRef } from './components/ChatPanel';
import CommandPalette, { createDefaultCommands, type CommandItem } from './components/CommandPalette';
import BottomPanel from './components/BottomPanel';
import type { TabInfo } from './components/SessionTabBar';

// Lazy-loaded components (dialogs/panels not needed on initial render)
const SessionBrowser = lazy(() => import('./components/SessionBrowser'));
const Settings = lazy(() => import('./components/Settings'));
const UsageStats = lazy(() => import('./components/UsageStats'));
const ToolSelector = lazy(() => import('./components/ToolSelector'));
const UpdateModal = lazy(() => import('./components/UpdateModal'));

// CSS imports for lazy-loaded components
import './components/ResizablePanel.css';
import './components/LogViewer.css';
import './components/SessionBrowser.css';
import './components/Settings.css';
import './components/UsageStats.css';
import './components/ToolSelector.css';

// Hooks
import { useLayoutState } from './hooks';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Panel layout type (includes 'split' for BottomPanel type compatibility)
type PanelLayout = 'terminal' | 'chat' | 'logs' | 'split';

// Color palette type
export type ColorPalette = 'default' | 'rose' | 'mint' | 'lavender' | 'peach' | 'sky';

const ChatApp: React.FC = () => {
  const { t } = useTranslation();

  // System state
  const [theme, setTheme] = useState<Theme>('light');
  const [fontSize, setFontSize] = useState<number>(12);
  const [colorPalette, setColorPalette] = useState<ColorPalette>('default');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);

  // Layout state hook (for BottomPanel sizing)
  const layoutState = useLayoutState();

  // Layout state (BottomPanel always fullscreen, always open)
  const [bottomPanelLayout, setBottomPanelLayout] = useState<PanelLayout>('chat');
  const [bottomPanelHeight, setBottomPanelHeight] = useState(300);

  // Working directory
  const [currentDirectory, setCurrentDirectory] = useState<string>('');

  // Multi-tab session state
  interface OpenTab {
    sessionId: string;
    session: Session;
    name: string;
    isRunning: boolean;
    hasUnread: boolean;
    allowAllPermissions: boolean; // per-session auto/supervised mode
    chatPanelRef: React.RefObject<ChatPanelRef | null>;
  }
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const MAX_TABS = 8;

  // Derived: active tab's session for backward compatibility
  const activeTab = useMemo(() => openTabs.find(t => t.sessionId === activeTabId), [openTabs, activeTabId]);
  const currentSession = activeTab?.session ?? null;
  const chatPanelRef = activeTab?.chatPanelRef ?? { current: null };

  // Update session by matching session.id (NOT activeTabId)
  // This ensures async callbacks (e.g. agent.run completing after tab switch)
  // update the correct tab regardless of which tab is currently active.
  const setCurrentSession = useCallback((session: Session | null) => {
    if (!session) return;
    setOpenTabs(prev => prev.map(tab =>
      tab.sessionId === session.id ? { ...tab, session } : tab
    ));
  }, []);

  const [isSessionBrowserOpen, setIsSessionBrowserOpen] = useState(false);

  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  // Per-session: auto/supervised mode derived from active tab
  const allowAllPermissions = activeTab?.allowAllPermissions ?? true;
  const [isUsageStatsOpen, setIsUsageStatsOpen] = useState(false);
  const [isToolSelectorOpen, setIsToolSelectorOpen] = useState(false);

  // VSCode auto-popup toggle (eye icon)
  const [autoFileView, setAutoFileView] = useState(true);
  const autoFileViewRef = useRef(autoFileView);
  useEffect(() => {
    autoFileViewRef.current = autoFileView;
  }, [autoFileView]);

  // VSCode availability toast state
  const [vscodeToast, setVscodeToast] = useState(false);
  const vscodeCheckedRef = useRef(false);

  // Command Palette state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  // App version
  const [appVersion, setAppVersion] = useState<string>('1.0.0');

  // Update modal state
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'>('checking');
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes?: string | { note?: string | null }[]; releaseDate?: string } | undefined>(undefined);
  const [updateProgress, setUpdateProgress] = useState<{ percent: number; transferred: number; total: number; bytesPerSecond: number } | undefined>(undefined);
  const [updateError, setUpdateError] = useState<string | undefined>(undefined);

  // Model selector state
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([]);
  const [currentEndpointId, setCurrentEndpointId] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Initialize app
  useEffect(() => {
    const init = async () => {
      if (!window.electronAPI) return;

      try {
        const [systemInfo, savedTheme, maximized, dirResult, config] = await Promise.all([
          window.electronAPI.system.info(),
          window.electronAPI.config.getTheme(),
          window.electronAPI.window.isMaximized(),
          window.electronAPI.powershell.getCurrentDirectory(),
          window.electronAPI.config.getAll(),
        ]);

        if (systemInfo?.appVersion) {
          setAppVersion(systemInfo.appVersion);
        }

        if (savedTheme === 'system') {
          const systemTheme = await window.electronAPI.theme.getSystem();
          setTheme(systemTheme);
        } else {
          setTheme(savedTheme as Theme);
        }

        const configAny = config as unknown as Record<string, unknown>;
        if (configAny?.fontSize && typeof configAny.fontSize === 'number') {
          setFontSize(configAny.fontSize);
          document.documentElement.style.setProperty('--user-font-size', `${configAny.fontSize}px`);
        }
        if (configAny?.colorPalette) {
          setColorPalette(configAny.colorPalette as ColorPalette);
        }
        if (configAny?.fontFamily && typeof configAny.fontFamily === 'string') {
          document.documentElement.style.setProperty(
            '--font-sans',
            configAny.fontFamily === 'default'
              ? "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
              : `'${configAny.fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          );
        }
        if (typeof configAny?.autoFileView === 'boolean') {
          setAutoFileView(configAny.autoFileView);
        }
        // UI 
        if (configAny?.uiScale && typeof configAny.uiScale === 'number') {
          document.documentElement.style.setProperty('--ui-scale', String(configAny.uiScale));
        }

        setIsMaximized(maximized);

        let directoryRestored = false;
        if (configAny?.lastOpenedDirectory && typeof configAny.lastOpenedDirectory === 'string') {
          try {
            const exists = await window.electronAPI.fs?.exists(configAny.lastOpenedDirectory as string);
            if (exists) {
              setCurrentDirectory(configAny.lastOpenedDirectory as string);
              directoryRestored = true;
            }
          } catch {
            // fs.exists   fallback
          }
        }
        if (!directoryRestored && dirResult.success && dirResult.directory) {
          setCurrentDirectory(dirResult.directory);
        }
      } catch (error) {
        window.electronAPI?.log?.error('[ChatApp] Failed to initialize', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    init();
  }, []);

  // Appearance change listener (Settings    )
  useEffect(() => {
    const unsub = window.electronAPI?.theme?.onAppearanceChange?.((data: { key: string; value: unknown }) => {
      if (data.key === 'fontSize' && typeof data.value === 'number') {
        setFontSize(data.value);
        document.documentElement.style.setProperty('--user-font-size', `${data.value}px`);
      } else if (data.key === 'uiScale' && typeof data.value === 'number') {
        document.documentElement.style.setProperty('--ui-scale', String(data.value));
      } else if (data.key === 'colorPalette' && typeof data.value === 'string') {
        setColorPalette(data.value as ColorPalette);
      }
    });
    return () => { unsub?.(); };
  }, []);

  // Event listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubMaximize = window.electronAPI.window.onMaximizeChange(setIsMaximized);
    const unsubFocus = window.electronAPI.window.onFocusChange(setIsFocused);
    const unsubTheme = window.electronAPI.theme.onChange(setTheme);

    return () => {
      unsubMaximize();
      unsubFocus();
      unsubTheme();
    };
  }, []);

  // Auto-update event listeners
  useEffect(() => {
    if (!window.electronAPI?.update) return;

    const unsubAvailable = window.electronAPI.update.onAvailable((info) => {
      setUpdateInfo(info);
      setUpdateStatus('available');
      // Silent background download — modal only shown after download completes
    });

    const unsubNotAvailable = window.electronAPI.update.onNotAvailable(() => {
      // Silent - no updates
    });

    const unsubProgress = window.electronAPI.update.onDownloadProgress((progress) => {
      setUpdateProgress(progress);
      setUpdateStatus('downloading');
    });

    const unsubDownloaded = window.electronAPI.update.onDownloaded((info) => {
      setUpdateInfo(info);
      setUpdateStatus('downloaded');
      setUpdateModalOpen(true);
    });

    const unsubError = window.electronAPI.update.onError((error) => {
      setUpdateError(error);
      setUpdateStatus('error');
      // Silent error — will retry on next periodic check (every 30min)
    });

    return () => {
      unsubAvailable();
      unsubNotAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  // Check VSCode availability on first file event and show toast if not installed
  const checkVscodeAndNotify = useCallback(async () => {
    if (vscodeCheckedRef.current) return;
    vscodeCheckedRef.current = true;

    if (localStorage.getItem('vscode-toast-dismissed')) return;

    try {
      const result = await window.electronAPI?.vscode?.isAvailable();
      if (!result?.available) {
        setVscodeToast(true);
      }
    } catch {
      // Ignore check errors
    }
  }, []);

  // File edit/create event listeners (VSCode only — no editor tabs)
  useEffect(() => {
    if (!window.electronAPI?.agent) return;

    const unsubEdit = window.electronAPI.agent.onFileEdit?.((data) => {
      if (!autoFileViewRef.current) return;
      checkVscodeAndNotify();
      window.electronAPI?.vscode?.openDiffWithContent?.({
        filePath: data.path,
        originalContent: data.originalContent,
        newContent: data.newContent,
      }).catch(() => {});
    });

    const unsubCreate = window.electronAPI.agent.onFileCreate?.((data) => {
      if (!autoFileViewRef.current) return;
      checkVscodeAndNotify();
      window.electronAPI?.vscode?.openFile?.(data.path).catch(() => {});
    });

    return () => {
      unsubEdit?.();
      unsubCreate?.();
    };
  }, [checkVscodeAndNotify]);

  // Load endpoints for model selector
  useEffect(() => {
    const loadEndpoints = async () => {
      if (!window.electronAPI?.llm) return;
      try {
        const result = await window.electronAPI.llm.getEndpoints();
        if (result.success && result.endpoints) {
          setEndpoints(result.endpoints);
          setCurrentEndpointId(result.currentEndpointId || null);
          setCurrentModelId(result.currentModelId || null);
        }
      } catch (err) {
        window.electronAPI?.log?.error('[ChatApp] Failed to load endpoints', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    if (!isSettingsOpen) {
      loadEndpoints();
    }
  }, [isSettingsOpen]);

  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelDropdownOpen]);

  // Handle model selection (endpoint    )
  const handleSelectModel = useCallback(async (endpointId: string, modelId?: string) => {
    if (!window.electronAPI?.llm) return;
    try {
      // endpoint   endpoint 
      if (endpointId !== currentEndpointId) {
        const epResult = await window.electronAPI.llm.setCurrentEndpoint(endpointId);
        if (epResult.success) {
          setCurrentEndpointId(endpointId);
        }
      }
      //  
      if (modelId) {
        const result = await window.electronAPI.llm.setCurrentModel(modelId);
        if (result.success) {
          setCurrentModelId(modelId);
        }
      }
    } catch (err) {
      window.electronAPI?.log?.error('[ChatApp] Failed to set model', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    setIsModelDropdownOpen(false);
  }, [currentEndpointId]);

  // Create a new tab with session + worker
  const handleNewSession = useCallback(async () => {
    if (!window.electronAPI?.session) return;
    if (openTabs.length >= MAX_TABS) {
      window.electronAPI?.log?.warn('[ChatApp] Max tabs reached', { max: MAX_TABS });
      return;
    }

    try {
      const result = await window.electronAPI.session.create(
        undefined,
        currentDirectory || undefined
      );
      if (result.success && result.session) {
        const sessionId = result.session.id;

        // Create worker for this session
        await window.electronAPI.worker?.create(sessionId);

        const newTab: OpenTab = {
          sessionId,
          session: result.session,
          name: t('sessionTab.defaultName'),
          isRunning: false,
          hasUnread: false,
          allowAllPermissions: true, // Default: Auto Mode
          chatPanelRef: createRef<ChatPanelRef>(),
        };

        setOpenTabs(prev => [...prev, newTab]);
        setActiveTabId(sessionId);
        // Notify task window of the active session
        window.electronAPI?.taskWindow?.setActiveSession?.(sessionId);
      }
    } catch (error) {
      window.electronAPI?.log?.error('[ChatApp] Failed to create session/tab', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [currentDirectory, openTabs.length, t]);

  // Restore previous tabs on startup, or create a new one
  const initTabCreated = useRef(false);
  useEffect(() => {
    if (initTabCreated.current || openTabs.length > 0) return;
    initTabCreated.current = true;

    const restoreOrCreate = async () => {
      try {
        const uiState = await window.electronAPI?.session?.loadUIState?.();
        if (uiState?.tabs?.length) {
          const restoredTabs: OpenTab[] = [];
          for (const sessionId of uiState.tabs) {
            try {
              const result = await window.electronAPI.session.load(sessionId);
              if (result.success && result.session) {
                await window.electronAPI.worker?.create(sessionId);
                restoredTabs.push({
                  sessionId,
                  session: result.session,
                  name: result.session.name || t('sessionTab.defaultName'),
                  isRunning: false,
                  hasUnread: false,
                  allowAllPermissions: true,
                  chatPanelRef: createRef<ChatPanelRef>(),
                });
              }
            } catch {
              // Skip sessions that fail to load (deleted, corrupted)
            }
          }
          if (restoredTabs.length > 0) {
            setOpenTabs(restoredTabs);
            const activeId = uiState.activeTabId && restoredTabs.some(t => t.sessionId === uiState.activeTabId)
              ? uiState.activeTabId
              : restoredTabs[0].sessionId;
            setActiveTabId(activeId);
            window.electronAPI?.taskWindow?.setActiveSession?.(activeId);
            return;
          }
        }
      } catch {
        // Failed to load UI state
      }
      // Fallback: create new session
      handleNewSession();
    };
    restoreOrCreate();
  }, [handleNewSession, openTabs.length, t]);

  // Persist open tabs state for restore after update/restart
  useEffect(() => {
    if (openTabs.length === 0) return;
    window.electronAPI?.session?.saveUIState?.({
      tabs: openTabs.map(t => t.sessionId),
      activeTabId,
    });
  }, [openTabs, activeTabId]);

  // Change working directory via folder picker
  const handleChangeDirectory = useCallback(async () => {
    if (!window.electronAPI?.dialog?.openFolder) return;
    try {
      const result = await window.electronAPI.dialog.openFolder({
        title: t('app.selectFolder'),
        defaultPath: currentDirectory || undefined,
      });
      if (result.success && result.filePath) {
        setCurrentDirectory(result.filePath);
        window.electronAPI?.config?.addRecentDirectory?.(result.filePath).catch(() => {});
      }
    } catch (error) {
      window.electronAPI?.log?.error('[ChatApp] Failed to change directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [currentDirectory]);

  // Load session from browser
  const handleLoadSession = useCallback(() => {
    setIsSessionBrowserOpen(true);
  }, []);

  // Handle session load from browser — opens in a new tab
  const handleSessionLoad = useCallback(async (sessionId: string) => {
    if (!window.electronAPI?.session) return;

    // Check if session is already open in a tab
    const existingTab = openTabs.find(t => t.sessionId === sessionId);
    if (existingTab) {
      setActiveTabId(sessionId);
      return;
    }

    if (openTabs.length >= MAX_TABS) {
      window.electronAPI?.log?.warn('[ChatApp] Max tabs reached');
      return;
    }

    try {
      const result = await window.electronAPI.session.load(sessionId);
      if (result.success && result.session) {
        // Create worker for this session
        await window.electronAPI.worker?.create(sessionId);

        const newTab: OpenTab = {
          sessionId,
          session: result.session,
          name: result.session.name || t('sessionTab.defaultName'),
          isRunning: false,
          hasUnread: false,
          allowAllPermissions: true, // Default: Auto Mode
          chatPanelRef: createRef<ChatPanelRef>(),
        };

        setOpenTabs(prev => [...prev, newTab]);
        setActiveTabId(sessionId);
      }
    } catch (error) {
      window.electronAPI?.log?.error('[ChatApp] Failed to load session', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [openTabs, t]);

  // Ref to always access the active tab's chatPanel (avoids stale closure)
  const activeChatPanelRef = useRef<ChatPanelRef | null>(null);
  useEffect(() => {
    activeChatPanelRef.current = activeTab?.chatPanelRef.current ?? null;
  }, [activeTab]);

  // Clear active tab's session
  const handleClearSession = useCallback(async () => {
    await activeChatPanelRef.current?.clear();
  }, []);

  // Handle delete current session (from SessionBrowser)
  const handleDeleteCurrentSession = useCallback(() => {
    if (!activeTabId) return;
    setOpenTabs(prev => {
      const remaining = prev.filter(t => t.sessionId !== activeTabId);
      // Activate adjacent tab (or null if none left)
      if (remaining.length > 0) {
        const closedIdx = prev.findIndex(t => t.sessionId === activeTabId);
        const newActiveIdx = Math.min(closedIdx, remaining.length - 1);
        setActiveTabId(remaining[newActiveIdx].sessionId);
      } else {
        setActiveTabId(null);
      }
      return remaining;
    });
  }, [activeTabId]);

  // Switch tab
  const handleSwitchTab = useCallback((sessionId: string) => {
    // Mark as read when switching to it (short-circuit if already not unread)
    setOpenTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId);
      if (!tab || !tab.hasUnread) return prev; // Already read → skip re-render
      return prev.map(t =>
        t.sessionId === sessionId ? { ...t, hasUnread: false } : t
      );
    });
    setActiveTabId(sessionId);
    // Notify task window so it shows the correct session's TODOs
    window.electronAPI?.taskWindow?.setActiveSession?.(sessionId);
  }, []);

  // Close tab
  const handleCloseTab = useCallback(async (sessionId: string) => {
    const tab = openTabs.find(t => t.sessionId === sessionId);
    if (!tab) return;

    // If running, ask confirmation (via window.confirm for simplicity)
    if (tab.isRunning) {
      const confirmed = window.confirm(t('sessionTab.closeConfirm'));
      if (!confirmed) return;
    }

    // Terminate worker
    await window.electronAPI?.worker?.terminate(sessionId);

    setOpenTabs(prev => {
      const remaining = prev.filter(t => t.sessionId !== sessionId);
      // If closing active tab, switch to adjacent tab
      if (sessionId === activeTabId && remaining.length > 0) {
        const closedIdx = prev.findIndex(t => t.sessionId === sessionId);
        const newActiveIdx = Math.min(closedIdx, remaining.length - 1);
        setActiveTabId(remaining[newActiveIdx].sessionId);
      } else if (remaining.length === 0) {
        setActiveTabId(null);
        // Auto-create a new tab
        setTimeout(() => handleNewSession(), 0);
      }
      return remaining;
    });
  }, [openTabs, activeTabId, t, handleNewSession]);

  // Rename tab
  const handleRenameTab = useCallback((sessionId: string, name: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.sessionId === sessionId ? { ...t, name } : t
    ));
    // Also update session name in backend
    window.electronAPI?.session?.rename?.(sessionId, name).catch(() => {});
  }, []);

  // Clear specific tab
  const handleClearTab = useCallback(async (sessionId: string) => {
    const tab = openTabs.find(t => t.sessionId === sessionId);
    if (tab) {
      await tab.chatPanelRef.current?.clear();
    }
  }, [openTabs]);

  // Mark tab as running/not running (called from agent events)
  // CRITICAL: Short-circuit when value hasn't changed. Without this, every tool call
  // triggers setOpenTabs → new array → ChatApp re-render → BottomPanel re-render
  // → ALL ChatPanels re-render → Korean IME composition breaks (" ").
  const setTabRunning = useCallback((sessionId: string, isRunning: boolean) => {
    setOpenTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId);
      if (!tab || tab.isRunning === isRunning) return prev; // No change → skip re-render
      return prev.map(t =>
        t.sessionId === sessionId ? { ...t, isRunning } : t
      );
    });
  }, []);

  // Mark tab as having unread activity
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // Mark tab as having unread activity
  // CRITICAL: Short-circuit when already unread or when it's the active tab.
  // Same reasoning as setTabRunning — prevents unnecessary re-renders.
  const setTabUnread = useCallback((sessionId: string) => {
    setOpenTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId);
      // Skip if: not found, already unread, or it's the active tab
      if (!tab || tab.hasUnread || sessionId === activeTabIdRef.current) return prev;
      return prev.map(t =>
        t.sessionId === sessionId ? { ...t, hasUnread: true } : t
      );
    });
  }, []);

  // Track tab running/unread state via agent events
  useEffect(() => {
    if (!window.electronAPI?.agent) return;

    const unsubscribes: Array<() => void> = [];

    // When tool call arrives → tab is running
    unsubscribes.push(
      window.electronAPI.agent.onToolCall((data: { toolName: string; args: Record<string, unknown>; sessionId?: string }) => {
        const sid = (data as any).sessionId;
        if (sid) {
          setTabRunning(sid, true);
          if (sid !== activeTabIdRef.current) {
            setTabUnread(sid);
          }
        }
      })
    );

    // When agent completes → tab is no longer running
    unsubscribes.push(
      window.electronAPI.agent.onComplete((data: { response: string; sessionId?: string }) => {
        const sid = (data as any).sessionId;
        if (sid) {
          setTabRunning(sid, false);
          if (sid !== activeTabIdRef.current) {
            setTabUnread(sid);
          }
        }
      })
    );

    // When agent errors → tab is no longer running
    unsubscribes.push(
      window.electronAPI.agent.onError((data: { error: string; sessionId?: string }) => {
        const sid = (data as any).sessionId;
        if (sid) {
          setTabRunning(sid, false);
        }
      })
    );

    // When Planning LLM provides a session title → update tab name
    if (window.electronAPI.agent.onSessionTitle) {
      unsubscribes.push(
        window.electronAPI.agent.onSessionTitle((title: string, eventSessionId?: string) => {
          if (eventSessionId && title) {
            handleRenameTab(eventSessionId, title);
          }
        })
      );
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [setTabRunning, setTabUnread, handleRenameTab]);

  // Build TabInfo array for SessionTabBar
  const tabInfos: TabInfo[] = useMemo(() =>
    openTabs.map(t => ({
      sessionId: t.sessionId,
      name: t.name,
      isRunning: t.isRunning,
      hasUnread: t.hasUnread,
    })),
  [openTabs]);

  // Command handlers for slash commands, command palette, and BottomPanel toolbar
  const commandHandlers = useMemo(() => ({
    onClear: async () => {
      await activeChatPanelRef.current?.clear();
    },
    onSettings: () => {
      setIsSettingsOpen(true);
    },
    onModel: () => {
      setIsSettingsOpen(true);
    },
    onTool: () => {
      setIsToolSelectorOpen(true);
    },
    onUsage: () => {
      setIsUsageStatsOpen(true);
    },
    onDocs: () => {
      // Docs feature disabled
    },
    onLoad: () => {
      setIsSessionBrowserOpen(true);
    },
    onCompact: async () => {
      await activeChatPanelRef.current?.compact();
    },
    onExit: () => {
      window.electronAPI?.window.close();
    },
    onInfo: () => {
      setIsInfoOpen(true);
    },
  }), []);

  // Create command palette commands
  const commands = useMemo<CommandItem[]>(() =>
    createDefaultCommands(commandHandlers),
  [commandHandlers]);

  // Track recent commands
  const handleCommandExecute = useCallback((commandId: string) => {
    setRecentCommands(prev => {
      const filtered = prev.filter(id => id !== commandId);
      return [commandId, ...filtered].slice(0, 5);
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: Close command palette first, then modals
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          e.preventDefault();
          setIsCommandPaletteOpen(false);
          return;
        }
        if (isInfoOpen) {
          e.preventDefault();
          setIsInfoOpen(false);
          return;
        }
      }

      // Command Palette: Ctrl+Shift+P or F1
      if ((e.ctrlKey && e.shiftKey && e.key === 'P') || e.key === 'F1') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Settings: Ctrl+,
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        commandHandlers.onSettings();
        return;
      }

      // Clear: Ctrl+L
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        commandHandlers.onClear();
        return;
      }

      // Model: Ctrl+M
      if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        commandHandlers.onModel();
        return;
      }

      // Load Session: Ctrl+O
      if (e.ctrlKey && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        commandHandlers.onLoad();
        return;
      }

      // New Tab: Ctrl+T or Ctrl+N
      if (e.ctrlKey && (e.key === 't' || e.key === 'n')) {
        e.preventDefault();
        handleNewSession();
        return;
      }

      // Close Tab: Ctrl+W
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
        return;
      }

      // Next Tab: Ctrl+Tab
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (openTabs.length > 1 && activeTabId) {
          const idx = openTabs.findIndex(t => t.sessionId === activeTabId);
          const nextIdx = (idx + 1) % openTabs.length;
          handleSwitchTab(openTabs[nextIdx].sessionId);
        }
        return;
      }

      // Previous Tab: Ctrl+Shift+Tab
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        if (openTabs.length > 1 && activeTabId) {
          const idx = openTabs.findIndex(t => t.sessionId === activeTabId);
          const prevIdx = (idx - 1 + openTabs.length) % openTabs.length;
          handleSwitchTab(openTabs[prevIdx].sessionId);
        }
        return;
      }

      // Tab by number: Ctrl+1~8
      if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        const tabIdx = parseInt(e.key) - 1;
        if (tabIdx < openTabs.length) {
          handleSwitchTab(openTabs[tabIdx].sessionId);
        }
        return;
      }

      // Toggle Terminal: Ctrl+`
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setBottomPanelLayout(prev => prev === 'terminal' ? 'chat' : 'terminal');
        return;
      }

      // Toggle DevTools: Ctrl+Shift+I or F12
      if ((e.ctrlKey && e.shiftKey && e.key === 'I') || e.key === 'F12') {
        e.preventDefault();
        window.electronAPI?.devTools.toggle();
        return;
      }

      // Toggle Log Viewer: Ctrl+Shift+L
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        setBottomPanelLayout('logs');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandHandlers, handleNewSession, handleCloseTab, handleSwitchTab, isCommandPaletteOpen, isInfoOpen, activeTabId, openTabs]);

  // Update modal handlers
  const handleUpdateInstall = useCallback(() => {
    window.electronAPI?.update?.install();
  }, []);

  const handleUpdateLater = useCallback(() => {
    const isForced = updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'downloaded';
    if (isForced) return;
    setUpdateModalOpen(false);
  }, [updateStatus]);

  const handleUpdateClose = useCallback(() => {
    const isForced = updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'downloaded';
    if (isForced) return;
    setUpdateModalOpen(false);
  }, [updateStatus]);

  return (
    <AgentProvider>
    <div
      className={`app-root ${!isFocused ? 'unfocused' : ''}`}
      data-theme={theme}
      data-palette={colorPalette}
      style={{ '--user-font-size': `${fontSize}px` } as React.CSSProperties}
    >
      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
        recentCommands={recentCommands}
        onCommandExecute={handleCommandExecute}
      />

      {/* Session Browser (Lazy) */}
      {isSessionBrowserOpen && (
        <Suspense fallback={<div className="loading-fallback">{t('common.loading')}</div>}>
          <SessionBrowser
            isOpen={isSessionBrowserOpen}
            onClose={() => setIsSessionBrowserOpen(false)}
            onLoadSession={handleSessionLoad}
            onDeleteCurrentSession={handleDeleteCurrentSession}
            currentSessionId={activeTabId || undefined}
          />
        </Suspense>
      )}

      {/* Settings (Lazy) */}
      {isSettingsOpen && (
        <Suspense fallback={<div className="loading-fallback">{t('common.loading')}</div>}>
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />
        </Suspense>
      )}

      {/* Info Modal */}
      {isInfoOpen && (
        <div className="info-modal-backdrop" onClick={() => setIsInfoOpen(false)}>
          <div className="info-modal" onClick={(e) => e.stopPropagation()}>
            <div className="info-modal-header">
              <h2>{t('info.title')}</h2>
              <button className="info-close-btn" onClick={() => setIsInfoOpen(false)} title={t('info.close')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="info-modal-content">
              <div className="info-item">
                <span className="info-label">{t('info.version')}</span>
                <span className="info-value">{appVersion}</span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('info.developer')}</span>
                <span className="info-value">syngha.han</span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('info.contact')}</span>
                <span className="info-value">gkstmdgk2731@naver.com</span>
              </div>
            </div>
            <div className="info-modal-footer">
              <button className="info-ok-btn" onClick={() => setIsInfoOpen(false)}>{t('info.ok')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Usage Statistics (Lazy) */}
      {isUsageStatsOpen && (
        <Suspense fallback={<div className="loading-fallback">{t('common.loading')}</div>}>
          <UsageStats
            isOpen={isUsageStatsOpen}
            onClose={() => setIsUsageStatsOpen(false)}
          />
        </Suspense>
      )}

      {/* Tool Selector (Lazy) */}
      {isToolSelectorOpen && (
        <Suspense fallback={<div className="loading-fallback">{t('common.loading')}</div>}>
          <ToolSelector
            isOpen={isToolSelectorOpen}
            onClose={() => setIsToolSelectorOpen(false)}
          />
        </Suspense>
      )}

      {/* Custom Title Bar */}
      <TitleBar
        title={t('app.title')}
        isMaximized={isMaximized}
        isFocused={isFocused}
        onMinimize={() => window.electronAPI?.window.minimize()}
        onMaximize={() => window.electronAPI?.window.maximize()}
        onClose={() => window.electronAPI?.window.close()}
      />

      {/* Main Content Area — BottomPanel takes all space */}
      <div className="content-area">
        <BottomPanel
          isOpen={true}
          layout={bottomPanelLayout}
          isFullscreen={true}
          height={bottomPanelHeight}
          layoutState={layoutState}
          currentDirectory={currentDirectory}
          currentSession={currentSession}
          allowAllPermissions={allowAllPermissions}
          endpoints={endpoints}
          currentEndpointId={currentEndpointId}
          currentModelId={currentModelId}
          isModelDropdownOpen={isModelDropdownOpen}
          modelDropdownRef={modelDropdownRef}
          chatPanelRef={chatPanelRef}
          commandHandlers={commandHandlers}
          onLayoutChange={setBottomPanelLayout}
          onFullscreenToggle={() => {}}
          onHeightChange={setBottomPanelHeight}
          onCollapse={() => {}}
          onSessionChange={setCurrentSession}
          onClearSession={handleClearSession}
          onNewSession={handleNewSession}
          onLoadSession={handleLoadSession}
          onAllowAllPermissionsChange={(value: boolean) => {
            if (!activeTabId) return;
            setOpenTabs(prev => {
              const tab = prev.find(t => t.sessionId === activeTabId);
              if (!tab || tab.allowAllPermissions === value) return prev;
              return prev.map(t =>
                t.sessionId === activeTabId ? { ...t, allowAllPermissions: value } : t
              );
            });
          }}
          onModelDropdownToggle={() => setIsModelDropdownOpen(prev => !prev)}
          onSelectModel={handleSelectModel}
          autoFileView={autoFileView}
          onAutoFileViewChange={(value: boolean) => {
            setAutoFileView(value);
            window.electronAPI?.config?.set?.('autoFileView', value).catch(() => {});
          }}
          onCommandPalette={() => setIsCommandPaletteOpen(true)}
          onToggleTaskWindow={() => window.electronAPI?.taskWindow?.toggle()}
          onChangeDirectory={handleChangeDirectory}
          // Multi-tab props
          openTabs={openTabs}
          activeTabId={activeTabId}
          tabInfos={tabInfos}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
          onClearTab={handleClearTab}
        />
      </div>

      {/* VSCode Install Toast */}
      {vscodeToast && (
        <div className="vscode-toast">
          <div className="vscode-toast-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.583 2.247l-9.27 8.605L3.095 6.96.01 8.72l5.206 3.957L.01 16.63l3.085 1.76 5.218-3.892 9.27 8.605L24 20.86V4.49l-6.417-2.243zM19.2 17.6l-5.818-4.927L19.2 7.746V17.6z"/>
            </svg>
          </div>
          <div className="vscode-toast-content">
            <span className="vscode-toast-title">{t('vscode.toast.title')}</span>
            <span className="vscode-toast-desc">{t('vscode.toast.desc')}</span>
          </div>
          <button
            className="vscode-toast-close"
            onClick={() => {
              setVscodeToast(false);
              localStorage.setItem('vscode-toast-dismissed', 'true');
            }}
            title={t('vscode.toast.close')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Update Modal (Lazy) */}
      {updateModalOpen && (
        <Suspense fallback={null}>
          <UpdateModal
            isOpen={updateModalOpen}
            status={updateStatus}
            updateInfo={updateInfo}
            progress={updateProgress}
            error={updateError}
            onInstall={handleUpdateInstall}
            onLater={handleUpdateLater}
            onClose={handleUpdateClose}
          />
        </Suspense>
      )}
    </div>
    </AgentProvider>
  );
};

export default ChatApp;
