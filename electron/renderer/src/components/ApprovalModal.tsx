/**
 * Approval Modal Component
 * Supervised Mode Tool      UI
 * - Approve:    
 * - Always Approve:    Tool  
 * - Reject:  + AI   
 */

import React, { useState, useRef, useEffect, memo, useMemo, useCallback } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import './ApprovalModal.css';

export interface ApprovalModalProps {
  isOpen: boolean;
  toolName: string;
  args: Record<string, unknown>;
  reason?: string;
  onResponse: (result: 'approve' | 'always' | { reject: true; comment: string }) => void;
  onCancel?: () => void;
}

/**
 * Format tool arguments for display
 */
function formatArgs(args: Record<string, unknown>): { key: string; value: string; isLong: boolean }[] {
  const result: { key: string; value: string; isLong: boolean }[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;

    let displayValue: string;
    let isLong = false;

    if (typeof value === 'string') {
      if (value.length > 300) {
        displayValue = value.substring(0, 300) + '...';
        isLong = true;
      } else if (value.includes('\n')) {
        const lines = value.split('\n');
        if (lines.length > 12) {
          displayValue = lines.slice(0, 12).join('\n') + '\n...';
          isLong = true;
        } else {
          displayValue = value;
          isLong = lines.length > 3;
        }
      } else {
        displayValue = value;
      }
    } else if (typeof value === 'object') {
      displayValue = JSON.stringify(value, null, 2);
      isLong = displayValue.length > 150;
    } else {
      displayValue = String(value);
    }

    result.push({ key, value: displayValue, isLong });
  }

  return result;
}

/**
 * Get icon for parameter key
 */
function getParamIcon(key: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    file_path: '📁',
    path: '📁',
    content: '📝',
    old_string: '➖',
    new_string: '➕',
    pattern: '🔍',
    message: '💬',
    reason: '💡',
    command: '⚡',
  };
  return icons[key] || '•';
}

/**
 * Get tool category and color
 */
function getToolCategory(toolName: string): { category: string; color: string } {
  if (toolName.includes('read') || toolName.includes('write') || toolName.includes('edit')) {
    return { category: 'file', color: '#3B82F6' };
  }
  if (toolName.includes('powershell') || toolName.includes('shell') || toolName.includes('bash')) {
    return { category: 'shell', color: '#10B981' };
  }
  if (toolName.includes('browser') || toolName.includes('chrome') || toolName.includes('edge')) {
    return { category: 'browser', color: '#0EA5E9' };
  }
  if (toolName.includes('word') || toolName.includes('excel') || toolName.includes('powerpoint')) {
    return { category: 'office', color: '#F59E0B' };
  }
  return { category: 'other', color: '#6B7280' };
}

const ApprovalModal: React.FC<ApprovalModalProps> = ({
  isOpen,
  toolName,
  args,
  reason,
  onResponse,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isRejectMode, setIsRejectMode] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize static options
  const options = useMemo(() => [
    { label: t('approval.approve'), description: t('approval.approveDesc'), icon: '✅', shortcut: '1' },
    { label: t('approval.alwaysApprove'), description: t('approval.alwaysDesc'), icon: '✅✅', shortcut: '2' },
    { label: t('approval.reject'), description: t('approval.rejectDesc'), icon: '❌', shortcut: '3' },
  ], [t]);

  // Memoize formatted args
  const formattedArgs = useMemo(() => formatArgs(args), [args]);

  // Memoize tool category
  const { category, color } = useMemo(() => getToolCategory(toolName), [toolName]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setIsRejectMode(false);
      setRejectComment('');
    }
  }, [isOpen]);

  // Focus input when reject mode is active
  useEffect(() => {
    if (isRejectMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isRejectMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (isRejectMode) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsRejectMode(false);
          setRejectComment('');
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onResponse({ reject: true, comment: rejectComment.trim() });
        }
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(selectedIndex);
          break;
        case '1':
          e.preventDefault();
          onResponse('approve');
          break;
        case '2':
          e.preventDefault();
          onResponse('always');
          break;
        case '3':
          e.preventDefault();
          setIsRejectMode(true);
          break;
        case 'Escape':
          e.preventDefault();
          if (onCancel) onCancel();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRejectMode, selectedIndex, rejectComment, onResponse, onCancel]);

  // Memoize select handler
  const handleSelect = useCallback((index: number) => {
    if (index === 0) {
      onResponse('approve');
    } else if (index === 1) {
      onResponse('always');
    } else if (index === 2) {
      setIsRejectMode(true);
    }
  }, [onResponse]);

  if (!isOpen) return null;

  return (
    <div className="approval-modal-backdrop">
      <div
        ref={containerRef}
        className="approval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-modal-title"
      >
        {/* Header */}
        <div className="approval-modal-header">
          <div className="approval-modal-icon" style={{ background: color }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
            </svg>
          </div>
          <div className="approval-modal-title-section">
            <h2 id="approval-modal-title" className="approval-modal-title">
              {t('approval.title')}
            </h2>
            <span className="approval-modal-subtitle">{t('approval.supervised')}</span>
          </div>
          <span className={`approval-modal-category category-${category}`}>
            {category.toUpperCase()}
          </span>
        </div>

        {/* Tool Info */}
        <div className="approval-modal-tool-info">
          <div className="tool-name-section">
            <span className="tool-name" style={{ color }}>{toolName}</span>
            {reason && <span className="tool-reason">{reason}</span>}
          </div>
        </div>

        {/* Arguments */}
        <div className="approval-modal-args">
          <div className="args-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            <span>{t('approval.arguments')}</span>
          </div>
          <div className="args-content">
            {formattedArgs.length === 0 ? (
              <div className="args-empty">{t('approval.noArguments')}</div>
            ) : (
              formattedArgs.map(({ key, value, isLong }, idx) => (
                <div key={idx} className={`arg-item ${isLong ? 'arg-long' : ''}`}>
                  <span className="arg-key">
                    {getParamIcon(key)} {key}:
                  </span>
                  <span className={`arg-value ${isLong ? 'arg-value-block' : ''}`}>
                    {value}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Reject Mode: Comment Input */}
        {isRejectMode ? (
          <div className="approval-modal-reject">
            <div className="reject-header">
              <span className="reject-icon">❌</span>
              <span>{t('approval.rejectWithComment')}</span>
            </div>
            <textarea
              ref={inputRef}
              className="reject-input"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder={t('approval.rejectPlaceholder')}
              rows={3}
            />
            <div className="reject-actions">
              <button
                className="reject-cancel-btn"
                onClick={() => {
                  setIsRejectMode(false);
                  setRejectComment('');
                }}
              >
                {t('approval.cancel')}
              </button>
              <button
                className="reject-submit-btn"
                onClick={() => onResponse({ reject: true, comment: rejectComment.trim() })}
              >
                {t('approval.rejectAndSend')}
              </button>
            </div>
          </div>
        ) : (
          /* Options */
          <div className="approval-modal-options">
            {options.map((option, index) => (
              <button
                key={index}
                className={`approval-option ${selectedIndex === index ? 'selected' : ''}`}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="option-shortcut">{option.shortcut}</span>
                <span className="option-icon">{option.icon}</span>
                <div className="option-content">
                  <span className="option-label">{option.label}</span>
                  <span className="option-description">{option.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        {!isRejectMode && (
          <div className="approval-modal-footer">
            <span>{t('approval.footer.move')}</span>
            <span>{t('approval.footer.select')}</span>
            <span>{t('approval.footer.number')}</span>
            <span>{t('approval.footer.cancel')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(ApprovalModal);
