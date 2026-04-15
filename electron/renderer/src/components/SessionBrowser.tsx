/**
 * Session Browser Component
 * -   
 * -  //
 * -  
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SessionSummary } from '../../../preload/index';
import { useTranslation } from '../i18n/LanguageContext';
import ConfirmModal from './ConfirmModal';
import './SessionBrowser.css';
import './ConfirmModal.css';

interface SessionBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSession: (sessionId: string) => void;
  onDeleteCurrentSession?: () => void;
  currentSessionId?: string;
}

const SessionBrowser: React.FC<SessionBrowserProps> = ({
  isOpen,
  onClose,
  onLoadSession,
  onDeleteCurrentSession,
  currentSessionId,
}) => {
  const { t, language } = useTranslation();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; sessionId: string | null }>({
    isOpen: false,
    sessionId: null,
  });

  //   
  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.session.list();
      if (result.success && result.sessions) {
        setSessions(result.sessions);
      } else {
        setError(result.error || t('session.errorLoad'));
      }
    } catch (err) {
      setError(t('session.errorLoadDetail'));
    } finally {
      setLoading(false);
    }
  }, []);

  //  
  const searchSessions = useCallback(async (query: string) => {
    if (!query.trim()) {
      loadSessions();
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.session.search(query);
      if (result.success && result.sessions) {
        setSessions(result.sessions);
      }
    } catch (err) {
      window.electronAPI?.log?.error('[SessionBrowser] Search failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [loadSessions]);

  //     
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm({ isOpen: true, sessionId });
  }, []);

  //    
  const confirmDeleteSession = useCallback(async () => {
    const sessionId = deleteConfirm.sessionId;
    if (!sessionId) return;

    const result = await window.electronAPI.session.delete(sessionId);
    if (result.success) {
      loadSessions();
      if (selectedSession === sessionId) {
        setSelectedSession(null);
      }
      //      
      if (currentSessionId === sessionId) {
        onDeleteCurrentSession?.();
      }
    }
    setDeleteConfirm({ isOpen: false, sessionId: null });
  }, [deleteConfirm.sessionId, loadSessions, selectedSession, currentSessionId, onDeleteCurrentSession]);

  //  
  const cancelDeleteSession = useCallback(() => {
    setDeleteConfirm({ isOpen: false, sessionId: null });
  }, []);

  //  
  const handleExportSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const result = await window.electronAPI.session.export(sessionId);
    if (result.success && result.data) {
      //   
      const saveResult = await window.electronAPI.dialog.saveFile({
        title: t('session.exportTitle'),
        defaultPath: `session-${sessionId}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (saveResult.success && saveResult.filePath) {
        await window.electronAPI.fs.writeFile(saveResult.filePath, result.data);
        await window.electronAPI.dialog.showMessage({
          type: 'info',
          title: t('session.exportSuccess'),
          message: t('session.exportSuccessMsg'),
        });
      }
    }
  }, []);

  //  
  const handleLoadSession = useCallback((sessionId: string) => {
    onLoadSession(sessionId);
    onClose();
  }, [onLoadSession, onClose]);

  //  
  const handleImportSession = useCallback(async () => {
    const result = await window.electronAPI.dialog.openFile({
      title: t('session.importTitle'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.success && result.filePath) {
      const fileResult = await window.electronAPI.fs.readFile(result.filePath);
      if (fileResult.success && fileResult.content) {
        const importResult = await window.electronAPI.session.import(fileResult.content);
        if (importResult.success) {
          loadSessions();
          await window.electronAPI.dialog.showMessage({
            type: 'info',
            title: t('session.importSuccess'),
            message: t('session.importSuccessMsg'),
          });
        } else {
          await window.electronAPI.dialog.showMessage({
            type: 'error',
            title: t('session.importError'),
            message: importResult.error || t('session.importErrorMsg'),
          });
        }
      }
    }
  }, [loadSessions]);

  //     
  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen, loadSessions]);

  //  
  useEffect(() => {
    const timer = setTimeout(() => {
      searchSessions(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, searchSessions]);

  // ESC  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  //  
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('time.justNow');
    if (diffMins < 60) return t('time.minutesAgo', { count: String(diffMins) });
    if (diffHours < 24) return t('time.hoursAgo', { count: String(diffHours) });
    if (diffDays < 7) return t('time.daysAgo', { count: String(diffDays) });

    return date.toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="session-browser-backdrop" onClick={onClose}>
      <div className="session-browser" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="session-browser-header">
          <h2>{t('session.title')}</h2>
          <button className="session-browser-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="session-browser-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.25 0a8.25 8.25 0 0 0-6.18 13.72L1 22.88l1.12 1.12 8.16-8.07A8.25 8.25 0 1 0 15.25.01V0zm0 15a6.75 6.75 0 1 1 0-13.5 6.75 6.75 0 0 1 0 13.5z"/>
          </svg>
          <input
            type="text"
            placeholder={t('session.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Session List */}
        <div className="session-browser-list">
          {loading ? (
            <div className="session-browser-loading">
              <div className="loading-spinner" />
              <span>{t('session.loading')}</span>
            </div>
          ) : error ? (
            <div className="session-browser-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>{error}</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="session-browser-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
              </svg>
              <span>{t('session.noSessions')}</span>
              <p>{t('session.noSessionsDesc')}</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${selectedSession === session.id ? 'selected' : ''} ${currentSessionId === session.id ? 'current' : ''}`}
                onClick={() => setSelectedSession(session.id)}
                onDoubleClick={() => handleLoadSession(session.id)}
              >
                <div className="session-item-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                  </svg>
                </div>
                <div className="session-item-content">
                  <div className="session-item-header">
                    <span className="session-item-name">{session.name}</span>
                    {currentSessionId === session.id && (
                      <span className="session-item-badge">{t('session.current')}</span>
                    )}
                  </div>
                  <div className="session-item-meta">
                    <span className="session-item-date">{formatDate(session.updatedAt)}</span>
                    <span className="session-item-messages">{t('session.messages', { count: String(session.messageCount) })}</span>
                  </div>
                  {session.preview && (
                    <div className="session-item-preview">{session.preview}</div>
                  )}
                  {session.workingDirectory && (
                    <div className="session-item-directory">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                      <span>{session.workingDirectory}</span>
                    </div>
                  )}
                </div>
                <div className="session-item-actions">
                  <button
                    className="session-action-btn"
                    onClick={(e) => handleExportSession(session.id, e)}
                    title={t('session.export')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                  </button>
                  <button
                    className="session-action-btn delete"
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    title={t('session.delete')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="session-browser-footer">
          <button className="session-browser-btn secondary" onClick={handleImportSession}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
            </svg>
            {t('session.import')}
          </button>
          <div className="session-browser-footer-spacer" />
          <button
            className="session-browser-btn primary"
            onClick={() => selectedSession && handleLoadSession(selectedSession)}
            disabled={!selectedSession}
          >
            {t('session.open')}
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        title={t('session.deleteTitle')}
        message={t('session.deleteMessage')}
        detail={t('session.deleteDetail')}
        confirmText={t('session.deleteConfirm')}
        cancelText={t('session.cancel')}
        type="danger"
        onConfirm={confirmDeleteSession}
        onCancel={cancelDeleteSession}
      />
    </div>
  );
};

export default SessionBrowser;
