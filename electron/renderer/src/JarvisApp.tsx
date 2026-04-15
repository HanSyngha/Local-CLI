/**
 * Jarvis UI — iOS iMessage-inspired autonomous assistant chat
 *
 * Design: Frosted glass titlebar, iMessage-style bubbles with tails,
 * app logo avatar, theme-integrated with the main Electron app.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { parseMarkdownSync } from './hooks';
import logoImage from '/no_bg_logo.png';
import './JarvisApp.css';

// =============================================================================
// Types
// =============================================================================

interface JarvisMessage {
  id: string;
  type: 'jarvis' | 'user' | 'system' | 'approval_request' | 'question' | 'execution_status';
  content: string;
  timestamp: number;
  requestId?: string;
  options?: string[];
  resolved?: boolean;
  resolvedValue?: string;
}

interface ModelOption {
  endpointId: string;
  endpointName: string;
  modelId: string;
  modelName: string;
}

// =============================================================================
// Component
// =============================================================================

const JarvisApp: React.FC = () => {
  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('idle');
  const [isFocused, setIsFocused] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Model selection
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load models
  useEffect(() => {
    const api = (window as any).electronAPI;
    (async () => {
      try {
        console.log('[JarvisApp] Loading models...');
        const result = await api?.llm?.getEndpoints?.();
        if (result?.success && result.endpoints) {
          const opts: ModelOption[] = [];
          for (const ep of result.endpoints) {
            for (const m of (ep.models || [])) {
              if (m.enabled !== false) {
                opts.push({ endpointId: ep.id, endpointName: ep.name, modelId: m.id, modelName: m.name });
              }
            }
          }
          setModels(opts);
          console.log('[JarvisApp] Models loaded:', opts.length);
        }
        const config = await api?.jarvis?.getConfig?.();
        if (config?.endpointId && config?.modelId) {
          setSelectedModelKey(`${config.endpointId}:${config.modelId}`);
          console.log('[JarvisApp] Jarvis model set from config:', config.modelId);
        } else if (result?.currentEndpointId && result?.currentModelId) {
          setSelectedModelKey(`${result.currentEndpointId}:${result.currentModelId}`);
          console.log('[JarvisApp] Model set from default:', result.currentModelId);
        }
      } catch (err) {
        console.warn('[JarvisApp] Failed to load models:', err);
      }
    })();
  }, []);

  const selectedModelName = useMemo(() => {
    const found = models.find(m => `${m.endpointId}:${m.modelId}` === selectedModelKey);
    return found ? found.modelName : ' ';
  }, [models, selectedModelKey]);

  const handleModelSelect = useCallback(async (endpointId: string, modelId: string) => {
    setSelectedModelKey(`${endpointId}:${modelId}`);
    setShowModelDropdown(false);
    await (window as any).electronAPI?.jarvis?.setConfig?.({ endpointId, modelId });
  }, []);

  // Restore chat history
  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.jarvis?.getChatHistory?.().then((history: JarvisMessage[]) => {
      if (history?.length > 0) {
        console.log('[JarvisApp] Chat history restored:', history.length, 'messages');
        setMessages(history);
      } else {
        console.log('[JarvisApp] No chat history to restore');
      }
    }).catch((err: unknown) => {
      console.warn('[JarvisApp] Failed to restore chat history:', err);
    });
  }, []);

  // IPC listeners
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.jarvis) {
      console.warn('[JarvisApp] electronAPI.jarvis is not available');
      return;
    }
    console.log('[JarvisApp] Registering IPC listeners');
    const cleanupMsg = api.jarvis.onMessage((msg: JarvisMessage) => {
      console.log('[JarvisApp] Message received:', { type: msg.type, id: msg.id, content: msg.content?.slice(0, 200), requestId: msg.requestId });
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    });
    const cleanupStatus = api.jarvis.onStatusChange((s: string) => {
      console.log('[JarvisApp] Status changed:', s);
      setStatus(s);
    });
    const cleanupFocus = api.window?.onFocusChange?.((f: boolean) => setIsFocused(f));
    return () => { cleanupMsg?.(); cleanupStatus?.(); cleanupFocus?.(); };
  }, []);

  // Send message
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    console.log('[JarvisApp] Sending message:', text.slice(0, 50));
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, type: 'user', content: text, timestamp: Date.now() }]);
    setInput('');
    (window as any).electronAPI?.jarvis?.sendMessage(text).catch((err: unknown) => {
      console.warn('[JarvisApp] Send message failed:', err);
      setMessages(prev => [...prev, { id: `err-${Date.now()}`, type: 'system', content: ' ', timestamp: Date.now() }]);
    });
    inputRef.current?.focus();
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleApproval = useCallback((requestId: string, approved: boolean) => {
    console.log('[JarvisApp] Approval response:', requestId, approved);
    setMessages(prev => prev.map(msg =>
      msg.requestId === requestId ? { ...msg, resolved: true, resolvedValue: approved ? '' : '' } : msg
    ));
    (window as any).electronAPI?.jarvis?.respondToApproval(requestId, approved);
  }, []);

  const handleQuestionAnswer = useCallback((requestId: string, answer: string) => {
    console.log('[JarvisApp] Question answer:', requestId, answer);
    setMessages(prev => prev.map(msg =>
      msg.requestId === requestId ? { ...msg, resolved: true, resolvedValue: answer } : msg
    ));
    (window as any).electronAPI?.jarvis?.respondToQuestion(requestId, answer);
  }, []);

  const statusMap: Record<string, { dot: string; label: string }> = {
    idle: { dot: 'idle', label: '' },
    polling: { dot: 'active', label: ' ' },
    analyzing: { dot: 'active', label: ' ' },
    executing: { dot: 'busy', label: ' ' },
    waiting_user: { dot: 'waiting', label: ' ' },
  };
  const si = statusMap[status] || statusMap.idle;

  // Timestamp formatter
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // =========================================================================
  return (
    <div className={`jv ${isFocused ? '' : 'jv--blur'}`}>
      {/* ── Frosted Titlebar ── */}
      <header className="jv-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="jv-header__left">
          <img src={logoImage} alt="" className="jv-header__logo" />
          <div className="jv-header__info">
            <span className="jv-header__name"></span>
            <span className={`jv-header__status jv-header__status--${si.dot}`}>
              <span className="jv-dot" />
              {si.label}
            </span>
          </div>
        </div>
        <div className="jv-header__actions" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="jv-header__btn" onClick={() => (window as any).electronAPI?.window?.minimize?.()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" rx=".75" fill="currentColor"/></svg>
          </button>
          <button className="jv-header__btn jv-header__btn--close" onClick={() => (window as any).electronAPI?.window?.close?.()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </header>

      {/* ── Model Pill ── */}
      <div className="jv-model-bar">
        <div style={{ position: 'relative' }}>
          <button className="jv-model-pill" onClick={() => setShowModelDropdown(!showModelDropdown)}>
            {selectedModelName}
            <svg width="8" height="8" viewBox="0 0 12 12" fill="currentColor"><path d="M2 4l4 4 4-4"/></svg>
          </button>
          {showModelDropdown && models.length > 0 && (
            <div className="jv-model-drop">
              {models.map(m => {
                const key = `${m.endpointId}:${m.modelId}`;
                return (
                  <button key={key} className={`jv-model-drop__item ${key === selectedModelKey ? 'is-active' : ''}`}
                    onClick={() => handleModelSelect(m.endpointId, m.modelId)}>
                    <span>{m.modelName}</span>
                    <span className="jv-model-drop__ep">{m.endpointName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="jv-messages" onClick={() => setShowModelDropdown(false)}>
        {messages.length === 0 && (
          <div className="jv-empty">
            <img src={logoImage} alt="" className="jv-empty__logo" />
            <p className="jv-empty__title"></p>
            <p className="jv-empty__sub">    </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isJarvis = msg.type === 'jarvis' || msg.type === 'approval_request' || msg.type === 'question';
          const isUser = msg.type === 'user';
          const isSystem = msg.type === 'system';
          const isExec = msg.type === 'execution_status';

          // Group: hide avatar if previous message is same sender
          const prev = messages[idx - 1];
          const sameGroup = prev && (
            (isJarvis && (prev.type === 'jarvis' || prev.type === 'approval_request' || prev.type === 'question')) ||
            (isUser && prev.type === 'user')
          );

          if (isSystem) {
            return (
              <div key={msg.id} className="jv-sys">
                <span>{msg.content}</span>
              </div>
            );
          }

          if (isExec) {
            const isDone = msg.content.includes('');
            const isFail = msg.content.includes('');
            const variant = isDone ? 'done' : isFail ? 'fail' : '';
            return (
              <div key={msg.id} className={`jv-exec-card ${variant ? `jv-exec-card--${variant}` : ''}`}>
                {!variant && <div className="jv-exec-card__spinner" />}
                {isDone && <span className="jv-exec-card__icon">✓</span>}
                {isFail && <span className="jv-exec-card__icon">✕</span>}
                <span className="jv-exec-card__text">{msg.content}</span>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`jv-row ${isUser ? 'jv-row--user' : 'jv-row--jarvis'} ${sameGroup ? 'jv-row--grouped' : ''}`}>
              {isJarvis && !sameGroup && (
                <img src={logoImage} alt="" className="jv-avatar" />
              )}
              {isJarvis && sameGroup && <div className="jv-avatar-spacer" />}

              <div className="jv-col">
                <div className={`jv-bubble ${isUser ? 'jv-bubble--user' : 'jv-bubble--jarvis'} ${!sameGroup ? 'jv-bubble--tail' : ''}`}>
                  {isUser
                    ? <p className="jv-bubble__text">{msg.content}</p>
                    : <div className="jv-bubble__text jv-bubble__markdown">{parseMarkdownSync(msg.content)}</div>
                  }

                  {/* Approval card */}
                  {msg.type === 'approval_request' && !msg.resolved && (
                    <div className="jv-card">
                      <button className="jv-card__btn jv-card__btn--ok" onClick={() => handleApproval(msg.requestId!, true)}></button>
                      <button className="jv-card__btn jv-card__btn--no" onClick={() => handleApproval(msg.requestId!, false)}></button>
                    </div>
                  )}

                  {/* Question card */}
                  {msg.type === 'question' && !msg.resolved && msg.options && (
                    <div className="jv-card">
                      {msg.options.map((opt, i) => (
                        <button key={i} className="jv-card__btn jv-card__btn--opt" onClick={() => handleQuestionAnswer(msg.requestId!, opt)}>{opt}</button>
                      ))}
                    </div>
                  )}

                  {msg.resolved && <p className="jv-bubble__resolved">✓ {msg.resolvedValue}</p>}
                </div>
                {!sameGroup && <span className="jv-time">{fmtTime(msg.timestamp)}</span>}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="jv-input-bar">
        <input ref={inputRef} className="jv-input" type="text"
          placeholder=" ..." value={input}
          onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} />
        <button className="jv-send" onClick={handleSend} disabled={!input.trim()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default JarvisApp;
