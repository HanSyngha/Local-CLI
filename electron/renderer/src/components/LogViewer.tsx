/**
 * LogViewer Component
 * - Linux CLI   
 * -   
 * -   /
 * -   
 * -    (//)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { LogEntry, LogCategory } from '../../../preload/index';
import { useTranslation } from '../i18n/LanguageContext';
import './LogViewer.css';

//   
const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
type LogLevelName = typeof LOG_LEVELS[number];

//    (description  )
const LOG_CATEGORIES: { id: LogCategory; label: string; descKey: string; color: string }[] = [
  { id: 'all', label: 'All', descKey: 'log.cat.all', color: '#8b5cf6' },
  { id: 'chat', label: 'Chat', descKey: 'log.cat.chat', color: '#10b981' },
  { id: 'tool', label: 'Tool', descKey: 'log.cat.tool', color: '#f59e0b' },
  { id: 'http', label: 'HTTP', descKey: 'log.cat.http', color: '#3b82f6' },
  { id: 'llm', label: 'LLM', descKey: 'log.cat.llm', color: '#ec4899' },
  { id: 'subagent', label: 'SubAgent', descKey: 'log.cat.subagent', color: '#f97316' },
  { id: 'ui', label: 'UI', descKey: 'log.cat.ui', color: '#06b6d4' },
  { id: 'system', label: 'System', descKey: 'log.cat.system', color: '#6366f1' },
  { id: 'debug', label: 'Debug', descKey: 'log.cat.debug', color: '#6b7280' },
];

/**
 *   
 *  prefix     
 *
 * json-stream-logger.ts StreamLogEntry.type :
 * - chat: user_input, assistant_response
 * - tool: tool_call, tool_start, tool_end, todo_update, planning_start, planning_end
 * - http: server_request, server_response, http_event
 * - llm: (LLM API )
 * - ui: ui_interaction, component_lifecycle, screen_change, form_event, modal_event,
 *       loading_event, animation_event, layout_event
 * - system: system_message, ipc_event, window_event, system_event, update_event, session_event
 * - debug: debug, info
 */
function detectCategory(message: string, level: string): LogCategory {
  const msg = message.toLowerCase();

  // SubAgent :  agent (Office, Browser, Desktop Control ) —   
  if (msg.includes('[subagent:') || msg.includes('[subagent]') ||
      msg.includes('sub-agent') || msg.includes('subagent[') ||
      // Desktop Control
      msg.includes('[desktop-control]') || msg.includes('desktop control') ||
      msg.includes('desktopcontrolsubagent') || msg.includes('desktop_control') ||
      msg.includes('capturescreen') || msg.includes('screenshot captured') ||
      msg.includes('vlm action') || msg.includes('vlm request') ||
      msg.includes('bring_window') || msg.includes('list_windows') ||
      msg.includes('bringwindowtoprimary') || msg.includes('mouseclick') ||
      msg.includes('presshotkey') || msg.includes('presskey') || msg.includes('typetext') ||
      // Office agents
      msg.includes('[word-agent]') || msg.includes('[excel-agent]') ||
      msg.includes('[powerpoint-agent]') || msg.includes('[pptx-agent]') ||
      // Browser agents
      msg.includes('[confluence-agent]') || msg.includes('[jira-agent]') ||
      msg.includes('[search-agent]') || msg.includes('[browser-agent]') ||
      msg.includes('browsersubagent')) {
    return 'subagent';
  }

  // Chat :  ,  
  if (msg.includes('[chat]') || msg.includes('[user]') || msg.includes('[assistant]') ||
      msg.includes('user message') || msg.includes('assistant response') ||
      msg.includes('user input') || msg.includes('send message') ||
      msg.includes('user_input') || msg.includes('assistant_response') ||
      msg.includes('message from user') || msg.includes('response from assistant')) {
    return 'chat';
  }

  // Tool :  
  if (msg.includes('[tool]') || msg.includes('[bash]') || msg.includes('[read]') ||
      msg.includes('[write]') || msg.includes('[edit]') || msg.includes('[glob]') ||
      msg.includes('[grep]') || msg.includes('tool:') || msg.includes('tool execution') ||
      msg.includes('toolcall') || msg.includes('tool call') || msg.includes('tool result') ||
      msg.includes('tool_call') || msg.includes('tool_start') || msg.includes('tool_end') ||
      msg.includes('tool start:') || msg.includes('tool end:') ||
      msg.includes('todo_update') || msg.includes('todo update') ||
      msg.includes('planning_start') || msg.includes('planning_end') ||
      msg.includes('planning start') || msg.includes('planning end')) {
    return 'tool';
  }

  // HTTP : HTTP /
  if (msg.includes('[http]') || msg.includes('[request]') || msg.includes('[response]') ||
      msg.includes('http request') || msg.includes('http response') ||
      msg.includes('fetch') || msg.includes('api call') ||
      msg.includes('stream start') || msg.includes('stream end') || msg.includes('stream chunk') ||
      msg.includes('server_request') || msg.includes('server_response') ||
      msg.includes('http_event') || msg.includes('http:') ||
      msg.includes('streamstart') || msg.includes('streamend') || msg.includes('streamchunk') ||
      msg.includes('browser server') || msg.includes('office server')) {
    return 'http';
  }

  // LLM : LLM API
  if (msg.includes('[llm]') || msg.includes('[api]') || msg.includes('[openai]') ||
      msg.includes('llm request') || msg.includes('llm response') ||
      msg.includes('completion') || msg.includes('model:') ||
      msg.includes('tokens') || msg.includes('chat:') ||
      msg.includes('llmrequest') || msg.includes('llmresponse') ||
      msg.includes('llm_request') || msg.includes('llm_response') ||
      msg.includes('anthropic') || msg.includes('claude') ||
      msg.includes('gpt-') || msg.includes('endpoint') ||
      msg.includes('prompt') && msg.includes('token')) {
    return 'llm';
  }

  // UI : UI 
  if (msg.includes('[ui]') || msg.includes('[component]') || msg.includes('[render]') ||
      msg.includes('[modal]') || msg.includes('[form]') || msg.includes('[dialog]') ||
      msg.includes('[loading]') || msg.includes('[animation]') || msg.includes('[layout]') ||
      msg.includes('component') || msg.includes('render') || msg.includes('mount') ||
      msg.includes('chatpanel') || msg.includes('logviewer') || msg.includes('settings') ||
      msg.includes('fileexplorer') || msg.includes('sessionbrowser') ||
      msg.includes('ui_interaction') || msg.includes('component_lifecycle') ||
      msg.includes('screen_change') || msg.includes('form_event') ||
      msg.includes('modal_event') || msg.includes('loading_event') ||
      msg.includes('animation_event') || msg.includes('layout_event') ||
      msg.includes('ui:') || msg.includes('modal') || msg.includes('toast') ||
      msg.includes('skeleton') || msg.includes('progress') && msg.includes('bar') ||
      msg.includes('viewport') || msg.includes('breakpoint') ||
      msg.includes('transition') || msg.includes('hover') ||
      msg.includes('statechange') || msg.includes('state change') ||
      msg.includes('click') || msg.includes('keyboard') || msg.includes('scroll')) {
    return 'ui';
  }

  // System :  
  if (msg.includes('[system]') || msg.includes('[session]') || msg.includes('[config]') ||
      msg.includes('[update]') || msg.includes('[window]') || msg.includes('[ipc]') ||
      msg.includes('[preload]') || msg.includes('[main]') || msg.includes('[app]') ||
      msg.includes('[global]') ||
      msg.includes('session') || msg.includes('startup') || msg.includes('shutdown') ||
      msg.includes('initialize') || msg.includes('electron') || msg.includes('window') ||
      msg.includes('system_message') || msg.includes('ipc_event') ||
      msg.includes('window_event') || msg.includes('system_event') ||
      msg.includes('update_event') || msg.includes('session_event') ||
      msg.includes('system:') || msg.includes('ipc:') ||
      msg.includes('appready') || msg.includes('appquit') ||
      msg.includes('app ready') || msg.includes('app quit') ||
      msg.includes('network') || msg.includes('theme') ||
      msg.includes('milestone') || msg.includes('feature usage')) {
    return 'system';
  }

  // Debug :  
  if (level === 'DEBUG' || msg.includes('[debug]') || msg.includes('debug:') ||
      msg.includes('[vars]') || msg.includes('[flow]') || msg.includes('[enter]') ||
      msg.includes('[exit]') || msg.includes('[state]') || msg.includes('[timer]') ||
      msg.includes('verbose') || msg.includes('trace')) {
    return 'debug';
  }

  // :   
  // ERROR, FATAL, WARN system
  if (level === 'ERROR' || level === 'FATAL' || level === 'WARN') {
    return 'system';
  }

  // INFO content    system
  return 'system';
}

//    (Linux CLI )
const LOG_LEVEL_COLORS: Record<LogLevelName, string> = {
  DEBUG: '#6b7280',   // gray
  INFO: '#38BDF8',    // sky blue
  WARN: '#f59e0b',    // amber
  ERROR: '#ef4444',   // red
  FATAL: '#dc2626',   // dark red
};

//   
const LOG_LEVEL_ICONS: Record<LogLevelName, string> = {
  DEBUG: '[D]',
  INFO: '[I]',
  WARN: '[W]',
  ERROR: '[E]',
  FATAL: '[F]',
};

interface LogViewerProps {
  isVisible?: boolean;
  onClose?: () => void;
  currentSessionId?: string | null;
}

const LogViewer: React.FC<LogViewerProps> = ({ isVisible = true, onClose }) => {
  const { t } = useTranslation();

  // 
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current Run log state
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  //  
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<Set<LogLevelName>>(new Set(LOG_LEVELS));
  const [categoryFilter, setCategoryFilter] = useState<LogCategory>('all'); //  
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);

  //   
  const [currentLogLevel, setCurrentLogLevel] = useState(1); // INFO

  // Refs
  const logContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Current Run   
  const loadCurrentRunLogEntries = useCallback(async () => {
    if (!window.electronAPI?.log?.readCurrentRunLog) {
      setError('Current run log API not available');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.log.readCurrentRunLog();
      if (result.success && result.entries) {
        setLogEntries(result.entries);
      } else {
        setError((result as any).error || 'Failed to read current run log');
      }
    } catch (err) {
      setError('Failed to load current run log entries');
      window.electronAPI?.log?.error('[LogViewer] Failed to load current run log entries', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Current Run ID 
  const loadCurrentRunId = useCallback(async () => {
    if (!window.electronAPI?.log?.getCurrentRunId) {
      return;
    }

    try {
      const result = await window.electronAPI.log.getCurrentRunId();
      if (result.success && result.runId) {
        setCurrentRunId(result.runId);
      }
    } catch (err) {
      window.electronAPI?.log?.error('[LogViewer] Failed to get current run ID', { error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  //   
  const clearAllLogs = useCallback(async () => {
    const confirmed = window.confirm(t('log.clearAllConfirm'));
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.log.clearAll();
      if (result.success) {
        setLogEntries([]);
      } else {
        setError(result.error || 'Failed to clear logs');
      }
    } catch (err) {
      setError('Failed to clear logs');
      window.electronAPI?.log?.error('[LogViewer] Failed to clear logs', { error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  //    (     )
  const [copySuccess, setCopySuccess] = useState(false);
  const copyLogsToClipboard = useCallback(async () => {
    try {
      //      (stale  )
      const result = await window.electronAPI.log.readCurrentRunLog();
      const freshEntries = result.success && result.entries ? result.entries : logEntries;

      if (freshEntries.length === 0) {
        setError('No log entries to copy');
        return;
      }

      const logText = freshEntries.map(entry => {
        const timestamp = new Date(entry.timestamp).toISOString();
        const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
        return `[${timestamp}] [${entry.level}] ${entry.message}${data}`;
      }).join('\n');

      await navigator.clipboard.writeText(logText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
      window.electronAPI?.log?.error('[LogViewer] Failed to copy to clipboard', { error: err instanceof Error ? err.message : String(err) });
    }
  }, [logEntries]);

  //   
  const openLogDirectory = useCallback(async () => {
    await window.electronAPI.log.openDirectory();
  }, []);

  //   
  const setLogLevel = useCallback(async (level: number) => {
    await window.electronAPI.log.setLevel(level);
    setCurrentLogLevel(level);
  }, []);

  //  - isVisible true     
  useEffect(() => {
    if (isVisible) {
      loadCurrentRunId();
      window.electronAPI.log.getLevel().then(setCurrentLogLevel);
      loadCurrentRunLogEntries();
    }
  }, [isVisible, loadCurrentRunId, loadCurrentRunLogEntries]);

  // Streaming event subscription removed - File mode only

  //  
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries, autoScroll]);

  //     (File mode only)
  const displayEntries = useMemo(() => {
    return logEntries.filter(entry => {
      //  
      const level = entry.level as LogLevelName;
      if (!levelFilter.has(level)) return false;

      //   (all  )
      if (categoryFilter !== 'all') {
        const entryCategory = entry.category || detectCategory(entry.message, entry.level);
        if (entryCategory !== categoryFilter) return false;
      }

      //  
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchMessage = entry.message.toLowerCase().includes(query);
        const matchData = entry.data ? JSON.stringify(entry.data).toLowerCase().includes(query) : false;
        if (!matchMessage && !matchData) return false;
      }

      return true;
    });
  }, [logEntries, levelFilter, categoryFilter, searchQuery]);

  //   
  const toggleLevelFilter = useCallback((level: LogLevelName) => {
    setLevelFilter(prev => {
      const newSet = new Set(prev);
      if (newSet.has(level)) {
        newSet.delete(level);
      } else {
        newSet.add(level);
      }
      return newSet;
    });
  }, []);

  //   /
  const _toggleAllLevels = useCallback(() => {
    if (levelFilter.size === LOG_LEVELS.length) {
      setLevelFilter(new Set(['ERROR', 'FATAL']));
    } else {
      setLevelFilter(new Set(LOG_LEVELS));
    }
  }, [levelFilter.size]);
  void _toggleAllLevels; // Suppress unused warning

  //  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f' && isVisible) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  //  
  const formatTimestamp = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  }, []);

  if (!isVisible) return null;

  return (
    <div className="log-viewer">
      {/*  */}
      <div className="log-viewer-header">
        <div className="log-viewer-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
            <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
          </svg>
          <span>{t('log.title')}</span>
        </div>
        <div className="log-viewer-actions">
          <button
            className="log-action-btn"
            onClick={openLogDirectory}
            title={t('log.openFolder')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
            </svg>
          </button>
          <button
            className="log-action-btn"
            onClick={clearAllLogs}
            title={t('log.clearOld')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
          {onClose && (
            <button className="log-close-btn" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/*  */}
      <div className="log-viewer-toolbar">
        {/* Current Run  */}
        <div className="log-current-run-info">
          <span className="run-indicator">● {t('log.live')}</span>
          <span className="run-id">{t('log.run')} {currentRunId ? currentRunId.slice(0, 16) : t('common.loading')}</span>
          <button
            className="log-action-btn refresh-btn"
            onClick={loadCurrentRunLogEntries}
            title={t('log.refreshLogs')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </div>

        {/*    */}
        <button
          className={`log-action-btn copy-btn ${copySuccess ? 'success' : ''}`}
          onClick={copyLogsToClipboard}
          title={t('log.copyToClipboard')}
        >
          {copySuccess ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          )}
          {copySuccess ? t('log.copied') : t('log.copyAll')}
        </button>

        {/*  */}
        <div className="log-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('log.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>

        {/*   */}
        <div className="log-level-filters">
          {LOG_LEVELS.map(level => (
            <button
              key={level}
              className={`level-filter-btn ${levelFilter.has(level) ? 'active' : ''}`}
              style={{ '--level-color': LOG_LEVEL_COLORS[level] } as React.CSSProperties}
              onClick={() => toggleLevelFilter(level)}
              title={level}
            >
              {level.charAt(0)}
            </button>
          ))}
        </div>

        {/*   */}
        <div className="log-category-filters">
          {LOG_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`category-filter-btn ${categoryFilter === cat.id ? 'active' : ''}`}
              style={{ '--category-color': cat.color } as React.CSSProperties}
              onClick={() => setCategoryFilter(cat.id)}
              title={t(cat.descKey)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/*  */}
        <div className="log-options">
          <button
            className={`option-btn ${showTimestamp ? 'active' : ''}`}
            onClick={() => setShowTimestamp(!showTimestamp)}
            title={t('log.showTimestamp')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
            </svg>
          </button>
          <button
            className={`option-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={t('log.autoScroll')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 13h-3V3h-2v10H8l4 4 4-4zM4 19v2h16v-2H4z"/>
            </svg>
          </button>
          <button
            className={`option-btn ${wrapLines ? 'active' : ''}`}
            onClick={() => setWrapLines(!wrapLines)}
            title={t('log.wrapLines')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z"/>
            </svg>
          </button>
        </div>

        {/*    */}
        <div className="log-level-setting">
          <span>{t('log.level')}</span>
          <select
            value={currentLogLevel}
            onChange={(e) => setLogLevel(Number(e.target.value))}
          >
            <option value={0}>DEBUG</option>
            <option value={1}>INFO</option>
            <option value={2}>WARN</option>
            <option value={3}>ERROR</option>
            <option value={4}>FATAL</option>
          </select>
        </div>
      </div>

      {/*   */}
      {error && (
        <div className="log-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          {error}
          <button onClick={() => setError(null)}>{t('log.dismiss')}</button>
        </div>
      )}

      {/*   */}
      <div
        ref={logContainerRef}
        className={`log-content ${wrapLines ? 'wrap' : ''}`}
      >
        {isLoading && (
          <div className="log-loading">
            <div className="spinner" />
            {t('log.loadingLogs')}
          </div>
        )}

        {!isLoading && displayEntries.length === 0 && (
          <div className="log-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
            </svg>
            <span>{t('log.noEntries')}</span>
            <span className="hint">{t('log.noEntriesHint')}</span>
          </div>
        )}

        {displayEntries.map((entry, index) => {
          const level = entry.level as LogLevelName;
          return (
            <div
              key={`${entry.timestamp}-${index}`}
              className={`log-entry log-level-${level.toLowerCase()}`}
              style={{ '--level-color': LOG_LEVEL_COLORS[level] } as React.CSSProperties}
            >
              {showTimestamp && (
                <span className="log-timestamp">
                  {formatTimestamp(entry.timestamp)}
                </span>
              )}
              <span className="log-level">{LOG_LEVEL_ICONS[level]}</span>
              <span className="log-message">{entry.message}</span>
              {entry.data !== undefined && entry.data !== null && (
                <span className="log-data">
                  {typeof entry.data === 'object'
                    ? JSON.stringify(entry.data, null, 2)
                    : String(entry.data as string | number | boolean)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/*  -  */}
      <div className="log-viewer-footer">
        <span className="log-count">
          {t('log.entries', { count: String(displayEntries.length) })} {t('log.thisRun')}
        </span>
      </div>
    </div>
  );
};

export default LogViewer;
