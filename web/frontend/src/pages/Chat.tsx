import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  Wifi,
  WifiOff,
  Loader2,
  Paperclip,
  ChevronRight,
  Timer,
  X,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { useSessionStore } from '@/stores/session.store';
import { useWebSocketStore } from '@/stores/websocket.store';
import { useAuthStore } from '@/stores/auth.store';
import ChatMessage from '@/components/ChatMessage';
import TodoPanel, { type TodoItem } from '@/components/TodoPanel';

/* ------------------------------------------------------------------ */
/*  Progress Ring SVG — Premium animated ring                          */
/* ------------------------------------------------------------------ */
function ProgressRing({ progress, size = 44, stroke = 3 }: { progress: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative">
      <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--bg-tertiary)" strokeWidth={stroke}
          opacity={0.5}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="url(#progressGradient)" strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          key={Math.round(progress)}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-xs font-bold text-[var(--text-primary)] tabular-nums"
        >
          {Math.round(progress)}%
        </motion.span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Duration Timer                                                     */
/* ------------------------------------------------------------------ */
function DurationTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1.5 text-xs text-[var(--accent)] tabular-nums font-mono bg-[var(--accent)]/8 px-2.5 py-1 rounded-lg"
    >
      <Timer size={11} />
      {min}:{sec.toString().padStart(2, '0')}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Chat Component                                                */
/* ------------------------------------------------------------------ */
export default function Chat() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const { currentSession, getSession } = useSessionStore();
  const {
    events,
    isConnected,
    isReconnecting,
    reconnectFailed,
    connect,
    disconnect,
    sendMessage,
    sendInterrupt,
    manualReconnect,
  } = useWebSocketStore();

  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [execStartTime, setExecStartTime] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Responsive: detect mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Connect to session
  useEffect(() => {
    if (sessionId && token) {
      getSession(sessionId);
      connect(sessionId, token);
    }
    return () => {
      disconnect();
    };
  }, [sessionId, token, getSession, connect, disconnect]);

  // Process events for todos and execution state
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];

    if (latest.type === 'todo:update') {
      const p = latest.payload;
      if (p.todos) setTodos(p.todos as TodoItem[]);
    }

    if (latest.type === 'planning:start') {
      setIsExecuting(true);
      setExecStartTime(Date.now());
    }

    if (latest.type === 'llm:token') {
      setStreamingText((prev) => prev + (latest.payload.content as string));
    }

    if (latest.type === 'session:complete' || latest.type === 'execution:complete') {
      setStreamingText('');
      setIsExecuting(false);
      setExecStartTime(null);
    }

    if (latest.type === 'error') {
      setIsExecuting(false);
      setExecStartTime(null);
    }
  }, [events]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, streamingText]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !isConnected) return;
    sendMessage(trimmed);
    setInput('');
    setIsExecuting(true);
    setExecStartTime(Date.now());
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isConnected, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    sendInterrupt();
    setIsExecuting(false);
    setExecStartTime(null);
  };

  // Filter displayable events
  const displayEvents = events.filter(
    (e) => e.type !== 'llm:token' && e.type !== 'todo:update' && e.type !== 'llm:reasoning',
  );

  // TODO progress
  const todoProgress = useMemo(() => {
    if (todos.length === 0) return 0;
    const done = todos.filter((t) => t.status === 'completed' || t.status === 'failed').length;
    return (done / todos.length) * 100;
  }, [todos]);

  const statusBadge = () => {
    if (!currentSession) return null;
    const status = currentSession.status;
    const colors: Record<string, string> = {
      RUNNING: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
      STOPPED: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
      CREATING: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
      DELETED: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
    };
    return (
      <span className={clsx('badge', colors[status])}>
        {status === 'RUNNING' && (
          <span className="relative w-1.5 h-1.5 mr-1.5">
            <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
            <span className="relative block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </span>
        )}
        {t(`session.status.${status?.toLowerCase()}`)}
      </span>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Sidebar content                                                  */
  /* ---------------------------------------------------------------- */
  const sidebarContent = (
    <div className="w-full h-full flex flex-col">
      {/* Session info */}
      <div className="p-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {currentSession?.name || 'Session'}
          </h2>
          <div className="flex items-center gap-2">
            {statusBadge()}
            {isMobile && (
              <button onClick={() => setMobileDrawer(false)} className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)]/40">
                <X size={16} className="text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
        </div>
        {currentSession?.agentName && (
          <p className="text-[11px] text-[var(--text-tertiary)]">{currentSession.agentName}</p>
        )}
      </div>

      {/* Connection status */}
      <div className="px-4 py-2.5 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">{t('chat.connected')}</span>
            </>
          ) : isReconnecting ? (
            <>
              <Loader2 size={12} className="text-amber-400 animate-spin" />
              <span className="text-[11px] text-amber-400">{t('chat.reconnecting')}</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-red-400" />
              <span className="text-[11px] text-red-400">
                {reconnectFailed ? t('chat.connectionLost', 'Connection lost') : t('chat.disconnected')}
              </span>
              {reconnectFailed && (
                <button onClick={manualReconnect} className="text-[11px] text-[var(--accent)] hover:underline ml-1">
                  {t('chat.reconnect', 'Reconnect')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* TODO panel with progress ring */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-hidden">
        {todos.length > 0 && (
          <div className="flex items-center gap-4 mb-5 p-3.5 rounded-xl bg-[var(--bg-primary)]/50 ring-1 ring-[var(--border)] backdrop-blur-sm">
            <ProgressRing progress={todoProgress} />
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                {todos.filter((t) => t.status === 'completed').length}/{todos.length} completed
              </p>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                {todos.filter((t) => t.status === 'in_progress').length > 0
                  ? `${todos.filter((t) => t.status === 'in_progress').length} in progress`
                  : 'Waiting'}
              </p>
            </div>
          </div>
        )}
        <TodoPanel todos={todos} />
      </div>
    </div>
  );

  return (
    <div className="h-full flex relative">
      {/* Execution progress bar — animated gradient line at top */}
      <AnimatePresence>
        {isExecuting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 left-0 right-0 h-[2px] z-50 overflow-hidden"
          >
            <div className="h-full w-full bg-[var(--bg-tertiary)]/50" />
            <motion.div
              className="absolute top-0 left-0 h-full w-1/3 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
              animate={{ x: ['-100%', '400%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      {!isMobile && (
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="border-r border-[var(--glass-border)] bg-[var(--bg-secondary)]/60 backdrop-blur-xl flex-shrink-0 overflow-hidden"
            >
              <div className="w-[320px] h-full">{sidebarContent}</div>
            </motion.aside>
          )}
        </AnimatePresence>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <AnimatePresence>
          {mobileDrawer && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="drawer-overlay fixed inset-0 z-40"
                onClick={() => setMobileDrawer(false)}
              />
              <motion.aside
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed left-0 top-0 bottom-0 w-[300px] bg-[var(--bg-secondary)] border-r border-[var(--glass-border)] z-50 shadow-elevation-4"
              >
                {sidebarContent}
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-[var(--glass-border)] flex items-center px-4 bg-[var(--bg-secondary)]/40 backdrop-blur-xl flex-shrink-0">
          <button
            onClick={() => (isMobile ? setMobileDrawer(!mobileDrawer) : setSidebarOpen(!sidebarOpen))}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]/40 transition-colors text-[var(--text-secondary)] mr-3"
          >
            {sidebarOpen && !isMobile ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mr-auto min-w-0">
            <span className="hidden sm:inline">{t('nav.sessions', 'Sessions')}</span>
            <ChevronRight size={11} className="hidden sm:inline flex-shrink-0" />
            <span className="text-[var(--text-primary)] font-medium truncate">
              {currentSession?.name || 'Session'}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {isExecuting && execStartTime && <DurationTimer startTime={execStartTime} />}
            {isExecuting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-1.5"
              >
                <div className="relative">
                  <Loader2 size={13} className="text-[var(--accent)] animate-spin" />
                </div>
                <span className="text-[11px] text-[var(--accent)] hidden sm:inline font-medium">{t('chat.executing')}</span>
              </motion.div>
            )}
            {isConnected ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-red-400" />
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-6">
          {displayEvents.length === 0 && !isExecuting && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                  className="relative w-24 h-24 mx-auto mb-6"
                >
                  {/* Glow behind */}
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[var(--accent)]/20 to-purple-600/20 blur-xl animate-breathe" />
                  {/* Main icon */}
                  <div className="relative w-24 h-24 rounded-3xl overflow-hidden border border-[var(--accent)]/15 backdrop-blur-sm">
                    <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
                  </div>
                  {/* Sparkle */}
                  <motion.div
                    className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center shadow-glow-sm"
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Sparkles size={12} className="text-white" />
                  </motion.div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <p className="text-[var(--text-secondary)] text-sm mb-1.5">{t('chat.placeholder')}</p>
                  <p className="text-[var(--text-tertiary)] text-xs">
                    <kbd className="px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)]/60 text-[10px] ring-1 ring-[var(--border)] font-mono">Enter</kbd>
                    {'  · '}
                    <kbd className="px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)]/60 text-[10px] ring-1 ring-[var(--border)] font-mono">Shift+Enter</kbd>
                    {' '}
                  </p>
                </motion.div>
              </div>
            </div>
          )}

          <div className="max-w-4xl mx-auto space-y-1">
            {displayEvents.map((event, i) => (
              <motion.div
                key={`${event._seq || i}-${event.type}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.015, 0.15), ease: [0.16, 1, 0.3, 1] }}
              >
                <ChatMessage
                  event={event}
                  onAskUserResponse={(_question, option) => {
                    const ws = useWebSocketStore.getState().ws;
                    if (ws) {
                      ws.send({
                        id: crypto.randomUUID(),
                        type: 'ask_user_response',
                        payload: { selectedOption: option, isOther: false },
                      });
                    }
                  }}
                />
              </motion.div>
            ))}

            {/* Streaming text with cursor */}
            {streamingText && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start mb-4"
              >
                <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[80%]">
                  <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--accent)] to-purple-500 p-[1.5px] flex-shrink-0">
                    <div className="w-full h-full rounded-[10px] bg-[var(--bg-primary)] flex items-center justify-center">
                      <Loader2 size={13} className="text-[var(--accent)] animate-spin" />
                    </div>
                  </div>
                  <div className="bg-[var(--bg-secondary)]/80 backdrop-blur-sm border border-[var(--glass-border)] px-4 py-3 rounded-2xl rounded-tl-lg shadow-elevation-1">
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                      {streamingText}
                      <span className="inline-block w-0.5 h-4 bg-[var(--accent)] ml-0.5 align-middle animate-cursor-blink rounded-full" />
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-[var(--glass-border)] bg-[var(--bg-secondary)]/40 backdrop-blur-xl p-3 sm:p-4">
          <div className="max-w-4xl mx-auto">
            <div className="chat-input-wrapper">
              <div className="chat-input-inner flex items-end gap-2 p-2 sm:p-3">
                {/* Attachment placeholder */}
                <button
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40 transition-colors flex-shrink-0 opacity-40 cursor-default"
                  title="File attachments coming soon"
                  disabled
                >
                  <Paperclip size={18} />
                </button>

                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.placeholder')}
                    disabled={!isConnected}
                    rows={1}
                    className="w-full bg-transparent text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none outline-none text-sm min-h-[36px] max-h-[200px] py-1.5 px-1 transition-[height] duration-150"
                  />
                </div>

                {/* Character count */}
                {input.length > 0 && (
                  <span className="text-[9px] text-[var(--text-tertiary)]/50 tabular-nums self-end pb-1.5 flex-shrink-0 font-mono">
                    {input.length}
                  </span>
                )}

                {isExecuting ? (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStop}
                    className="btn-danger flex items-center gap-1.5 py-2 px-3 text-sm flex-shrink-0 rounded-xl"
                  >
                    <Square size={14} />
                    <span className="hidden sm:inline">{t('chat.stop')}</span>
                  </motion.button>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={handleSend}
                    disabled={!input.trim() || !isConnected}
                    className={clsx(
                      'flex items-center justify-center p-2.5 rounded-xl transition-all duration-200 flex-shrink-0',
                      input.trim() && isConnected
                        ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-glow-sm hover:shadow-glow-md'
                        : 'bg-[var(--bg-tertiary)]/60 text-[var(--text-tertiary)] cursor-not-allowed opacity-40',
                    )}
                  >
                    <Send size={16} />
                  </motion.button>
                )}
              </div>
            </div>

            {/* Hint */}
            <p className="text-[9px] text-[var(--text-tertiary)]/40 mt-1.5 text-center font-mono">
              Enter  · Shift+Enter 
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
