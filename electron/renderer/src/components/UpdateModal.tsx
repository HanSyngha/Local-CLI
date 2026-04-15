/**
 * Update Modal Component
 *   →   → silent install +  
 */

import React, { useEffect, memo, useState } from 'react';
import './UpdateModal.css';

interface UpdateInfo {
  version: string;
  releaseNotes?: string | { note?: string | null }[];
  releaseDate?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

interface UpdateModalProps {
  isOpen: boolean;
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available';
  updateInfo?: UpdateInfo;
  progress?: DownloadProgress;
  error?: string;
  onInstall: () => void;
  onLater: () => void;
  onClose: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatSpeed = (bytesPerSecond: number): string => {
  return formatBytes(bytesPerSecond) + '/s';
};

/** Strip HTML tags and decode basic entities */
const stripHtml = (html: string): string => {
  const withoutTags = html.replace(/<[^>]*>/g, '');
  return withoutTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  status,
  updateInfo,
  progress,
  error,
  onInstall,
  onClose,
}) => {
  const [currentVersion, setCurrentVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.update?.getVersion?.().then(setCurrentVersion);
  }, []);

  // ESC only for non-forced states (not-available, error)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && (status === 'not-available' || status === 'error')) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, status, onClose]);

  if (!isOpen) return null;

  const parseReleaseNotes = (notes?: string | { note?: string | null }[]): string => {
    if (!notes) return '';
    if (typeof notes === 'string') return stripHtml(notes);
    if (Array.isArray(notes)) {
      return notes.map(n => stripHtml(n.note || '')).filter(Boolean).join('\n');
    }
    return '';
  };

  const isForced = status === 'available' || status === 'downloading' || status === 'downloaded';

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <>
            <div className="update-modal-icon update-modal-icon-checking">
              <svg className="update-modal-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            </div>
            <h2 className="update-modal-title">  </h2>
            <p className="update-modal-message">    ...</p>
          </>
        );

      case 'not-available':
        return (
          <>
            <div className="update-modal-icon update-modal-icon-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h2 className="update-modal-title"> </h2>
            <p className="update-modal-message"> v{currentVersion}  .</p>
          </>
        );

      case 'available':
      case 'downloading':
        return (
          <>
            <div className="update-modal-icon update-modal-icon-update">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
            </div>
            <h2 className="update-modal-title">  </h2>
            <div className="update-modal-version-info">
              <span className="update-modal-version-current">v{currentVersion}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
              </svg>
              <span className="update-modal-version-new">v{updateInfo?.version}</span>
            </div>
            {progress && (
              <div className="update-modal-progress">
                <div className="update-modal-progress-bar">
                  <div
                    className="update-modal-progress-fill"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="update-modal-progress-info">
                  <span>{formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
                  <span>{formatSpeed(progress.bytesPerSecond)}</span>
                </div>
              </div>
            )}
            {parseReleaseNotes(updateInfo?.releaseNotes) && (
              <div className="update-modal-notes">
                <strong>:</strong>
                <p>{parseReleaseNotes(updateInfo?.releaseNotes)}</p>
              </div>
            )}
          </>
        );

      case 'downloaded':
        return (
          <>
            <div className="update-modal-icon update-modal-icon-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h2 className="update-modal-title">  </h2>
            <p className="update-modal-message">v{updateInfo?.version}  .   .</p>
          </>
        );

      case 'error':
        return (
          <>
            <div className="update-modal-icon update-modal-icon-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
            </div>
            <h2 className="update-modal-title"> </h2>
            <p className="update-modal-message update-modal-error">{error || '   .'}</p>
          </>
        );

      default:
        return null;
    }
  };

  const renderActions = () => {
    if (status === 'downloaded') {
      return (
        <button className="update-modal-btn update-modal-btn-primary" onClick={onInstall}>
           
        </button>
      );
    }
    if (status === 'not-available' || status === 'error') {
      return (
        <button className="update-modal-btn update-modal-btn-primary" onClick={onClose}>
          
        </button>
      );
    }
    return null;
  };

  return (
    <div className="update-modal-backdrop" onClick={isForced ? undefined : onClose}>
      <div
        className="update-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        <div className="update-modal-content">
          {renderContent()}
        </div>

        {(() => {
          const actions = renderActions();
          return actions && (
            <div className="update-modal-actions">
              {actions}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default memo(UpdateModal);
