/**
 * Chat Panel Component (Optimized)
 *
 * Performance optimizations:
 * 1. Tool executions moved to AgentContext (prevents re-renders)
 * 2. Memoized message components
 * 3. Batched state updates
 * 4. Windowed message rendering
 */

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo, memo } from 'react';
import type {
  Session,
  ChatMessage,
  AgentConfig,
} from '../../../preload/index';

// Import optimized markdown hook
import { useMarkdownWorker } from '../hooks/useMarkdownWorker';
import { htmlTableToMarkdown } from '../utils/markdown-parser';

// Import AgentContext
import { useAgent } from '../contexts/AgentContext';

// Import i18n
import { useTranslation } from '../i18n/LanguageContext';

// Exposed methods via ref
export interface ChatPanelRef {
  clear: () => Promise<void>;
  compact: () => Promise<void>;
}

import TodoList from './TodoList';
import UserQuestion from './UserQuestion';
import ProgressMessage from './ProgressMessage';
import ToolExecution, { ToolExecutionData, ToolCategory } from './ToolExecution';
import ApprovalModal from './ApprovalModal';
import './ChatPanel.css';

// Timeline item for interleaved rendering
type TimelineItem =
  | { type: 'message'; data: ChatMessage; timestamp: number }
  | { type: 'tools'; data: ToolExecutionData[]; timestamp: number };

/**
 * Reconstruct ToolExecutionData[] from saved messages for session restore.
 * Matches tool_calls (assistant) with tool responses to rebuild the execution history.
 */
function reconstructToolExecutions(msgs: ChatMessage[]): ToolExecutionData[] {
  const tools: ToolExecutionData[] = [];
  const categoryMap: Record<string, ToolCategory> = {
    read_file: 'file', write_file: 'file', edit_file: 'file', create_file: 'file',
    list_files: 'file', search_files: 'file', view_file: 'file',
    bash: 'shell', execute_command: 'shell',
    browser_navigate: 'browser', browser_click: 'browser', browser_type: 'browser',
    browser_screenshot: 'browser', browser_get_html: 'browser',
    read_excel: 'office', write_excel: 'office', read_word: 'office', write_word: 'office',
    todo_write: 'todo', todo_read: 'todo',
    tell_to_user: 'user', ask_to_user: 'user', final_response: 'user',
  };

  for (const msg of msgs) {
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
    for (const tc of msg.tool_calls) {
      const response = msgs.find(m => m.role === 'tool' && m.tool_call_id === tc.id);
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
      const output = response?.content || '';
      tools.push({
        id: tc.id,
        toolName: tc.function.name,
        category: categoryMap[tc.function.name] || 'other',
        status: response ? (output.startsWith('[interrupted') ? 'error' : 'success') : 'error',
        input: args,
        output: output.length > 2000 ? output.substring(0, 2000) + '...' : output || undefined,
        timestamp: msg.timestamp,
      });
    }
  }
  return tools;
}

// Import logo for assistant avatar
import logoImage from '/no_bg_logo.png';

import './TodoList.css';
import './UserQuestion.css';
import './ProgressMessage.css';
import './ToolExecution.css';

interface AttachedImage {
  path: string;
  preview: string; // data URL for thumbnail
  name: string;
}

interface ChatPanelProps {
  session?: Session | null;
  sessionId?: string;
  isActive?: boolean;
  onSessionChange?: (session: Session | null) => void;
  onClearSession?: () => void;
  currentDirectory?: string;
  onChangeDirectory?: () => void;
  allowAllPermissions?: boolean;
  onAllowAllPermissionsChange?: (value: boolean) => void;
  hasVisionModel?: boolean;
}

// Memoized markdown content component - uses optimized hook
interface MemoizedMessageContentProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
}

const MemoizedMessageContent = memo<MemoizedMessageContentProps>(({ content, role }) => {
  // Use optimized markdown hook with LRU cache
  const { content: workerContent, isLoading } = useMarkdownWorker(
    role === 'assistant' || role === 'system' ? content : ''
  );

  // For user messages, just return plain text
  if (role === 'user') {
    return <p>{content}</p>;
  }

  // Show loading state briefly
  if (isLoading && !workerContent.length) {
    return <p>{content.slice(0, 100)}...</p>;
  }

  return <>{workerContent}</>;
});
MemoizedMessageContent.displayName = 'MemoizedMessageContent';

// Memoized single message component
interface MessageItemProps {
  message: ChatMessage;
  isBatchLoad: boolean;
}

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

const MessageItem = memo<MessageItemProps>(({ message, isBatchLoad }) => {
  const [copied, setCopied] = React.useState(false);
  const { t } = useTranslation();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      window.electronAPI?.log?.error('[MessageItem] Failed to copy', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div
      className={`chat-message ${message.role}${isBatchLoad ? ' no-animation' : ''}`}
    >
      {message.role === 'assistant' && (
        <div className="message-avatar">
          <img src={logoImage} alt="Assistant" width="18" height="18" />
        </div>
      )}
      <div className="message-content">
        <MemoizedMessageContent content={message.content} role={message.role as 'system' | 'user' | 'assistant'} />
        {/* Copy button for all message types */}
        <button
          className={`message-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title={copied ? t('chat.copied') : t('chat.copyMessage')}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          )}
        </button>
      </div>
      {message.role !== 'system' && message.id !== 'welcome' && (
        <div className="message-timestamp">{formatMessageTime(message.timestamp)}</div>
      )}
    </div>
  );
});
MessageItem.displayName = 'MessageItem';

// Default welcome message (will be replaced by translated version inside component)
const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '', // Filled by useEffect with t('chat.welcome')
  timestamp: Date.now(),
};

const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({
  session,
  sessionId: sessionIdProp,
  isActive: isActiveProp = true,
  onSessionChange,
  onClearSession,
  currentDirectory,
  onChangeDirectory,
  allowAllPermissions = true,
  onAllowAllPermissionsChange,
  hasVisionModel = false,
}, ref) => {
  const { t, language } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([{ ...DEFAULT_WELCOME_MESSAGE, content: '' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Track if we're doing a batch load (for animation disabling)
  const [isBatchLoad, setIsBatchLoad] = useState(true);

  // Update welcome message when language changes
  useEffect(() => {
    setMessages(prev => {
      const hasWelcome = prev.some(m => m.id === 'welcome');
      if (!hasWelcome) return prev;
      return prev.map(msg =>
        msg.id === 'welcome' ? { ...msg, content: t('chat.welcome') } : msg
      );
    });
  }, [language, t]);

  // Message windowing for performance (only render recent messages)
  const MAX_VISIBLE_MESSAGES = 50;
  const [showAllMessages, setShowAllMessages] = useState(false);

  // Compute visible messages for rendering
  // Filter out tool messages and tool-call-only assistant messages for UI rendering
  // These are shown as ToolExecution cards, not as chat bubbles
  const renderableMessages = useMemo(() => {
    return messages.filter(m => {
      if (m.role === 'tool') return false;
      // Hide assistant messages that only have tool_calls but no visible content
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0 && !m.content?.trim()) return false;
      return true;
    });
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (showAllMessages || renderableMessages.length <= MAX_VISIBLE_MESSAGES) {
      return renderableMessages;
    }
    return renderableMessages.slice(-MAX_VISIBLE_MESSAGES);
  }, [renderableMessages, showAllMessages]);

  const hasHiddenMessages = renderableMessages.length > MAX_VISIBLE_MESSAGES && !showAllMessages;
  const hiddenMessageCount = hasHiddenMessages ? renderableMessages.length - MAX_VISIBLE_MESSAGES : 0;

  // Use AgentContext for tool state (prevents re-renders)
  const {
    toolExecutions,
    clearToolExecutions,
    restoreToolExecutions,
    switchSession,
    clearSessionCache,
    progressMessages,
    dismissProgressMessage,
    clearProgressMessages,
    todos,
    clearTodos,
    setIsExecuting,
    currentQuestion,
    isQuestionOpen,
    handleQuestionAnswer,
    handleQuestionCancel,
    approvalRequest,
    isApprovalOpen,
    handleApprovalResponse,
    handleApprovalCancel,
    setupAgentListeners,
  } = useAgent();

  // Create unified timeline of messages and tool executions
  // Messages maintain their array order (authoritative). Tool executions are inserted
  // between messages based on tool timestamps falling between message timestamps.
  const timeline = useMemo<TimelineItem[]>(() => {
    if (toolExecutions.length === 0) {
      // Fast path: no tool executions, just messages in order
      return visibleMessages.map(msg => ({
        type: 'message' as const,
        data: msg,
        timestamp: msg.timestamp,
      }));
    }

    const items: TimelineItem[] = [];

    // Build message entries with stable ordering timestamps.
    // Use array index as tiebreaker to guarantee order even if timestamps are identical.
    const msgEntries = visibleMessages.map((msg, idx) => ({
      type: 'message' as const,
      data: msg,
      timestamp: msg.timestamp,
      order: idx,
    }));

    // Group consecutive tool executions together
    const toolGroups: { data: ToolExecutionData[]; timestamp: number }[] = [];
    let currentGroup: ToolExecutionData[] = [];
    for (const tool of toolExecutions) {
      if (currentGroup.length > 0) {
        const lastTool = currentGroup[currentGroup.length - 1];
        // Start new group if gap > 30 seconds (different conversation turn)
        if (tool.timestamp - lastTool.timestamp > 30000) {
          toolGroups.push({ data: currentGroup, timestamp: currentGroup[0].timestamp });
          currentGroup = [tool];
        } else {
          currentGroup.push(tool);
        }
      } else {
        currentGroup.push(tool);
      }
    }
    if (currentGroup.length > 0) {
      toolGroups.push({ data: currentGroup, timestamp: currentGroup[0].timestamp });
    }

    // For each message, add it to timeline. Insert tool groups that belong before it.
    let toolIdx = 0;
    for (const msgEntry of msgEntries) {
      // Insert any tool groups whose timestamp is before this message
      while (toolIdx < toolGroups.length && toolGroups[toolIdx].timestamp <= msgEntry.timestamp) {
        items.push({
          type: 'tools',
          data: toolGroups[toolIdx].data,
          timestamp: toolGroups[toolIdx].timestamp,
        });
        toolIdx++;
      }
      items.push({
        type: 'message',
        data: msgEntry.data,
        timestamp: msgEntry.timestamp,
      });
    }

    // Append any remaining tool groups after the last message
    while (toolIdx < toolGroups.length) {
      items.push({
        type: 'tools',
        data: toolGroups[toolIdx].data,
        timestamp: toolGroups[toolIdx].timestamp,
      });
      toolIdx++;
    }

    return items;
  }, [visibleMessages, toolExecutions]);

  // Input history state
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // LLM retry exhausted — 재시도 버튼 표시 상태
  const [retryableError, setRetryableError] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Monotonic run counter — incremented on each sendMessage() and handleAbort().
  // Used to detect stale agent.run() results: if the counter changed while awaiting,
  // the result is from an aborted/superseded run and must be discarded.
  // Fixes: (1) duplicate old responses on abort, (2) race condition between concurrent sendMessage calls.
  const sendRunIdRef = useRef(0);

  // Retry auto-send: handleRetry sets input + this ref, useEffect triggers sendMessage
  const pendingRetryRef = useRef(false);

  // Track if we're programmatically updating messages (sending or clearing)
  // This prevents session change effect from overwriting our messages
  const skipSessionLoadRef = useRef(false);

  // Refs for session/onSessionChange to avoid stale closures in async callbacks
  // sendMessage is async and agent.run() can take a long time - session may change during execution
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;

  // Sync AgentContext active session when tab becomes active
  // (switchSession must be called on tab switch, not just session change)
  useEffect(() => {
    if (isActiveProp && sessionIdProp) {
      switchSession(sessionIdProp);
    }
  }, [isActiveProp, sessionIdProp, switchSession]);

  // Load session messages when session changes
  // Skip if we're programmatically updating messages
  useEffect(() => {
    // NOTE: switchSession is NOT called here. It is handled by the dedicated Effect above
    // (line 348-352) which triggers on [isActiveProp, sessionIdProp] changes.
    // Having switchSession in BOTH effects caused duplicate calls and extra re-renders.

    // Don't reset messages during send/clear operations
    if (skipSessionLoadRef.current) {
      window.electronAPI?.log?.debug?.('[ChatPanel] Session load SKIPPED (skipSessionLoadRef=true)', {
        sessionId: session?.id,
        sessionMsgCount: session?.messages?.length ?? 0,
      });
      return;
    }
    window.electronAPI?.log?.info?.('[ChatPanel] Session load effect RUNNING', {
      sessionId: session?.id,
      sessionMsgCount: session?.messages?.length ?? 0,
      currentMsgCount: messages.length,
      firstMsgId: messages[0]?.id,
    });

    setIsBatchLoad(true); // Disable animation for batch load
    if (session && session.messages.length > 0) {
      window.electronAPI?.log?.debug?.('[ChatPanel] Restoring session messages', { count: session.messages.length });
      setMessages(session.messages);
      // Reconstruct tool execution history from messages so tool cards show on session restore
      const restoredTools = reconstructToolExecutions(session.messages);
      restoreToolExecutions(restoredTools);
      if (restoredTools.length > 0) {
        window.electronAPI?.log?.debug?.('[ChatPanel] Restored tool executions from messages', { count: restoredTools.length });
      }
    } else {
      // New or empty session: reset to welcome
      setMessages([{ ...DEFAULT_WELCOME_MESSAGE, content: t('chat.welcome') }]);
      restoreToolExecutions([]); // Clear any leftover tools from previous session
    }
    // Reset windowing state and attached images when session changes
    setShowAllMessages(false);
    setAttachedImages([]);
    setInput('');

    // Re-enable animation after batch load completes
    const timer = setTimeout(() => setIsBatchLoad(false), 100);
    return () => clearTimeout(timer);
  }, [session?.id]);

  // Setup agent listeners once
  useEffect(() => {
    window.electronAPI?.log?.debug?.('[ChatPanel] Setting up agent listeners');
    const cleanup = setupAgentListeners();
    return cleanup;
  }, [setupAgentListeners]);

  // Save message to session (defined early for use in other hooks)
  // NOTE: In multi-tab mode (sessionIdProp set), this is SKIPPED because
  // session:addMessage uses sessionManager.currentSession which is ambiguous
  // with multiple tabs. The full session is saved after agent.run() completes
  // via session.save(updatedSession) which correctly uses sessionRef.current.
  const saveMessageToSession = useCallback(async (message: ChatMessage) => {
    // Multi-tab mode: skip — session is fully saved after agent.run() via session.save()
    if (sessionIdProp) return;

    if (!window.electronAPI?.session) return;

    try {
      await window.electronAPI.session.addMessage(message);
    } catch (error) {
      window.electronAPI?.log?.error('[ChatPanel] Failed to save message to session', { error: error instanceof Error ? error.message : String(error) });
    }
  }, [sessionIdProp]);

  // NOTE: onFinalResponse removed — it uses a single global ref in AgentContext,
  // so with multiple ChatPanels only the last-mounted panel receives the callback.
  // Instead, responses are added to UI in sendMessage() from agent.run() return value.

  // Handle agent completion/error (adds messages)
  // Filter by sessionId when in multi-tab mode
  useEffect(() => {
    if (!window.electronAPI?.agent) return;

    const unsubscribes: Array<() => void> = [];

    // Helper: check if event belongs to this ChatPanel's session
    const isMyEvent = (data: { sessionId?: string }): boolean => {
      // If no sessionId in data, it's legacy single-session — always mine
      if (!data.sessionId) return true;
      // If no sessionIdProp, this is a single-panel fallback — always mine
      if (!sessionIdProp) return true;
      return data.sessionId === sessionIdProp;
    };

    // Agent complete event — logging only.
    // Loading state and messages are handled by sendMessage() via agent.run() return/finally.
    unsubscribes.push(
      window.electronAPI.agent.onComplete((data) => {
        if (!isMyEvent(data as any)) return;
        window.electronAPI?.log?.info?.('[ChatPanel] Agent complete event', {
          hasResponse: !!data.response,
          responseLength: data.response?.length ?? 0,
          sessionId: (data as any).sessionId,
        });
        // Note: setIsLoading/setIsExecuting handled in sendMessage() finally block
      })
    );

    // Agent error event — logging only.
    // Error handling is in sendMessage() catch block.
    unsubscribes.push(
      window.electronAPI.agent.onError((data) => {
        if (!isMyEvent(data as any)) return;
        window.electronAPI?.log?.error?.('[ChatPanel] Agent error event', {
          error: data.error,
          sessionId: (data as any).sessionId,
        });
        // Note: Error messages and setIsLoading handled in sendMessage() catch/finally block
      })
    );

    // LLM retry exhausted event — show retry button
    if (window.electronAPI?.agent?.onRetryableError) {
      unsubscribes.push(
        window.electronAPI.agent.onRetryableError((data) => {
          if (!isMyEvent(data as any)) return;
          setRetryableError(true);
          setIsLoading(false);
          setIsExecuting(false);
          const errorMessage: ChatMessage = {
            id: `retry-error-${Date.now()}`,
            role: 'system',
            content: `LLM 서버가 응답하지 않습니다.\n6회 재시도 + 2분 대기 후에도 실패했습니다.\n\n아래 "재시도" 버튼을 눌러주세요.`,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, errorMessage]);
        })
      );
    }

    // Countdown event — show countdown during 2-minute wait
    if (window.electronAPI?.agent?.onCountdown) {
      unsubscribes.push(
        window.electronAPI.agent.onCountdown((data) => {
          if (!isMyEvent(data as any)) return;
          setCountdownSeconds(data.seconds > 0 ? data.seconds : null);
        })
      );
    }

    // Tell user event - now handled in AgentContext as tool execution
    // for unified UI design with other tools

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [setIsExecuting, saveMessageToSession, sessionIdProp]);

  // Auto-scroll to bottom - optimized with throttle
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  // Auto-scroll when messages, tools, todos, or progress messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isLoading, toolExecutions.length, todos.length, progressMessages.length, scrollToBottom]);

  // Dynamic max input height (50% of window height)
  const [maxInputHeight, setMaxInputHeight] = useState(() => Math.floor(window.innerHeight * 0.5));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setMaxInputHeight(Math.floor(window.innerHeight * 0.5)), 100);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Auto-resize textarea (also recalculate when tab becomes active via isActiveProp)
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const newHeight = Math.min(inputRef.current.scrollHeight, maxInputHeight);
      inputRef.current.style.height = `${newHeight}px`;
      inputRef.current.style.overflowY = inputRef.current.scrollHeight > maxInputHeight ? 'auto' : 'hidden';
    }
  }, [input, maxInputHeight, isActiveProp]);

  // Send message using agent
  const sendMessage = useCallback(async () => {
    if ((!input.trim() && attachedImages.length === 0) || isLoading) return;

    // Detect resume scenario: user typed correction while paused with pending TODOs
    const hasPendingTodos = todos.some(
      (t: { status: string }) => t.status === 'pending' || t.status === 'in_progress'
    );
    const shouldResume = isPaused && hasPendingTodos;
    if (isPaused) {
      setIsPaused(false);
      setAbortMessage(null);
    }

    // Claim a run ID. If handleAbort() or another sendMessage() increments this
    // while we're awaiting agent.run(), our result is stale and must be discarded.
    sendRunIdRef.current++;
    const myRunId = sendRunIdRef.current;

    window.electronAPI?.log?.info?.('[ChatPanel] sendMessage START', {
      inputLength: input.trim().length,
      sessionId: sessionRef.current?.id,
      hasSession: !!sessionRef.current,
      currentMsgCount: messages.length,
      runId: myRunId,
    });

    // Mark to skip session load effect (prevents user message from disappearing)
    skipSessionLoadRef.current = true;

    // Build message content with attached images
    let messageContent = input.trim();
    if (attachedImages.length > 0) {
      const imagePaths = attachedImages.map(img => img.path).join(', ');
      const imageInstruction = `[Attached Images: ${imagePaths}]\nPlease analyze the attached images using read_image tool.`;
      messageContent = messageContent
        ? `${messageContent}\n\n${imageInstruction}`
        : imageInstruction;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
    };

    setMessages(prev => {
      window.electronAPI?.log?.debug?.('[ChatPanel] Adding user message', { prevCount: prev.length, msgId: userMessage.id });
      return [...prev, userMessage];
    });

    // Save to input history
    setInputHistory(prev => {
      const filtered = prev.filter(h => h !== input.trim());
      return [...filtered, input.trim()].slice(-50);
    });
    setHistoryIndex(-1);

    setInput('');
    setAttachedImages([]);
    setIsLoading(true);
    setIsExecuting(true);

    // Clear progress messages but keep tool executions visible
    // Tool executions are cleared only on explicit "Clear Chat", not between messages
    clearProgressMessages();

    // On resume after pause: clear old tool executions so new ones appear after user's correction message
    if (shouldResume) {
      clearToolExecutions();
    }

    // Auto-create session if none exists
    if (!sessionRef.current && window.electronAPI?.session) {
      window.electronAPI?.log?.info?.('[ChatPanel] Auto-creating session (no session exists)');
      try {
        const result = await window.electronAPI.session.create('New Chat', currentDirectory);
        if (result.success && result.session && onSessionChangeRef.current) {
          window.electronAPI?.log?.info?.('[ChatPanel] Session auto-created', { newSessionId: result.session.id });
          onSessionChangeRef.current(result.session);
        }
      } catch (error) {
        window.electronAPI?.log?.error('[ChatPanel] Failed to create session', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Save user message to session backend
    // Keep skipSessionLoadRef=true until agent.run() completes to prevent
    // session load effect from overwriting messages (auto-created session has empty messages)
    await saveMessageToSession(userMessage);

    // Check if agent API is available
    if (!window.electronAPI?.agent) {
      window.electronAPI?.log?.warn('[ChatPanel] electronAPI.agent not available, using fallback');
      skipSessionLoadRef.current = false;
      setTimeout(async () => {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `I received your message: "${userMessage.content}"\n\n*Note: Agent not connected. Configure an endpoint in Settings.*`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        setIsExecuting(false);
        await saveMessageToSession(assistantMessage);
      }, 500);
      return;
    }

    // Build conversation history for agent
    // Use session.messages (full history with tool_calls) if available,
    // otherwise fall back to UI messages (user/assistant text only)
    const sessionMessages = sessionRef.current?.messages;
    const conversationMessages = (sessionMessages && sessionMessages.length > 0)
      ? sessionMessages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role as 'user' | 'assistant' | 'tool',
            content: m.content || '',
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          }))
      : messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Agent config
    // CLI parity: no iteration limit - runs until LLM stops calling tools
    const agentConfig: AgentConfig = {
      workingDirectory: currentDirectory,
      autoMode: allowAllPermissions,
      ...(shouldResume ? { resumeTodos: true } : {}),
    };

    try {
      window.electronAPI?.log?.info?.('[ChatPanel] agent.run() START', {
        conversationMsgCount: conversationMessages.length,
        autoMode: agentConfig.autoMode,
        runId: myRunId,
      });
      const result = await window.electronAPI.agent.run(
        userMessage.content,
        conversationMessages,
        agentConfig,
        sessionIdProp
      );

      // === Stale run guard ===
      // If handleAbort() or another sendMessage() ran while we were awaiting,
      // this result is from an aborted/superseded run. Discard it entirely:
      // - Don't add duplicate old responses to UI (fixes Bug 1: abort returning old response)
      // - Don't save corrupted session state (fixes Bug 2: tool history ordering after abort+resend)
      // - Don't reset loading state (the new run is still active)
      if (myRunId !== sendRunIdRef.current) {
        window.electronAPI?.log?.info?.('[ChatPanel] Discarding superseded agent result', {
          myRunId,
          currentRunId: sendRunIdRef.current,
          sessionId: sessionIdProp,
          resultMsgCount: result.messages?.length ?? 0,
        });
        return;
      }

      window.electronAPI?.log?.info?.('[ChatPanel] agent.run() DONE', {
        success: result.success,
        resultMsgCount: result.messages?.length ?? 0,
        error: result.error,
        runId: myRunId,
      });

      // Display assistant response from result.response (authoritative source).
      // Previously we scanned result.messages for the last assistant message,
      // but result.messages includes OLD conversation history — on abort this caused
      // old responses to be found and duplicated. result.response is always correct:
      // - Direct response from planning: the LLM's text
      // - final_response tool: the tool's message output
      // - Abort: empty string (nothing to display)
      if (result.response && result.response.trim()) {
        const normalizedContent = result.response
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: normalizedContent,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        window.electronAPI?.log?.info?.('[ChatPanel] Added assistant response to UI', {
          contentLength: normalizedContent.length,
          sessionId: sessionIdProp,
        });
      }

      // Save all messages (including tool messages) to session for proper compact support
      // result.messages includes: user, assistant (with tool_calls), tool responses
      // Use refs to avoid stale closure (agent.run can take a long time)
      // BUG FIX: Only save on success — on error, failed tool loop messages accumulate
      // in the session and get re-sent to the LLM on the next attempt, causing a snowball
      // effect (1→4→7→14 messages) that triggers repeated HTTP 400 errors.
      const currentSession = sessionRef.current;
      const currentOnSessionChange = onSessionChangeRef.current;
      if (result.success && result.messages && result.messages.length > 0 && currentSession && currentOnSessionChange) {
        // Preserve existing message timestamps — only assign new timestamps to messages
        // added during this execution cycle. Rewriting ALL timestamps breaks timeline
        // ordering (toolExecutions use real-time timestamps, so old tools get displaced).
        const existingMessages = currentSession.messages || [];
        const existingCount = existingMessages.length;
        const agentEnd = Date.now();

        const updatedMessages: ChatMessage[] = result.messages.map((m, idx) => {
          // Reuse existing message if within the range of previously saved messages
          if (idx < existingCount && existingMessages[idx]) {
            return {
              ...existingMessages[idx],
              content: m.content || existingMessages[idx].content,
              tool_calls: (m as any).tool_calls || existingMessages[idx].tool_calls,
              tool_call_id: (m as any).tool_call_id || existingMessages[idx].tool_call_id,
            };
          }
          // New messages from this cycle: assign sequential timestamps after user message
          const newIdx = idx - existingCount;
          const newCount = result.messages.length - existingCount;
          const step = newCount > 1 ? (agentEnd - userMessage.timestamp) / (newCount - 1) : 0;
          return {
            id: `msg-${userMessage.timestamp}-${idx}`,
            role: m.role as 'user' | 'assistant' | 'system' | 'tool',
            content: m.content || '',
            tool_calls: (m as any).tool_calls,
            tool_call_id: (m as any).tool_call_id,
            timestamp: Math.round(userMessage.timestamp + (newIdx * step)),
          };
        });

        const updatedSession: Session = {
          ...currentSession,
          messages: updatedMessages,
          updatedAt: Date.now(),
        };

        if (window.electronAPI?.session) {
          await window.electronAPI.session.save(updatedSession);
        }
        currentOnSessionChange(updatedSession);
      }

      if (!result.success && result.error) {
        window.electronAPI?.log?.error('[ChatPanel] Agent error', { error: result.error });
      }
    } catch (error) {
      // Stale run guard for catch block too
      if (myRunId !== sendRunIdRef.current) return;

      window.electronAPI?.log?.error('[ChatPanel] Agent error', { error: error instanceof Error ? error.message : String(error) });
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      // Only reset loading state if this is still the current run.
      // If a newer run is active (user sent new message after abort),
      // resetting here would kill the new run's loading indicator.
      if (myRunId === sendRunIdRef.current) {
        setIsLoading(false);
        setIsExecuting(false);
        setTimeout(() => {
          skipSessionLoadRef.current = false;
        }, 500);
        window.electronAPI?.log?.debug?.('[ChatPanel] sendMessage FINALLY - reset loading state', { runId: myRunId });
      } else {
        window.electronAPI?.log?.debug?.('[ChatPanel] sendMessage FINALLY - skipped (stale run)', { myRunId, currentRunId: sendRunIdRef.current });
      }
    }
  }, [input, isLoading, messages, saveMessageToSession, currentDirectory, allowAllPermissions, clearProgressMessages, clearToolExecutions, setIsExecuting, attachedImages, isPaused, todos]);

  // Retry handler — 마지막 유저 메시지로 자동 재전송
  const handleRetry = useCallback(() => {
    setRetryableError(false);
    setCountdownSeconds(null);
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      setInput(lastUserMsg.content);
      pendingRetryRef.current = true;
    }
  }, [messages]);

  // Auto-send after retry button click (pendingRetryRef triggers sendMessage on next render)
  useEffect(() => {
    if (pendingRetryRef.current && input.trim() && !isLoading) {
      pendingRetryRef.current = false;
      sendMessage();
    }
  }, [input, isLoading, sendMessage]);

  // Abort/Pause state
  const [abortMessage, setAbortMessage] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Two-stage abort: 1st click = pause (keep TODOs), 2nd click = full stop (clear TODOs)
  const handleAbort = useCallback(async () => {
    if (!window.electronAPI?.agent) return;

    if (isPaused) {
      // 2nd click (or click while paused): full stop
      window.electronAPI?.log?.info?.('[ChatPanel] handleAbort: full stop (2nd click)', { sessionId: sessionIdProp });
      sendRunIdRef.current++;
      await window.electronAPI.agent.abort(sessionIdProp);
      setIsLoading(false);
      setIsExecuting(false);
      setIsPaused(false);
      clearTodos();
      setTimeout(() => { skipSessionLoadRef.current = false; }, 500);
      setAbortMessage(t('chat.aborted'));
      setTimeout(() => setAbortMessage(null), 5000);
    } else if (isLoading) {
      // 1st click: pause (keep TODOs for resume)
      window.electronAPI?.log?.info?.('[ChatPanel] handleAbort: pause (1st click)', { sessionId: sessionIdProp });
      sendRunIdRef.current++;
      await window.electronAPI.agent.pause(sessionIdProp);
      setIsLoading(false);
      setIsExecuting(false);
      setIsPaused(true);
      setTimeout(() => { skipSessionLoadRef.current = false; }, 500);
      // Don't clearTodos() — user can resume with correction
      setAbortMessage('⏸ ' + t('chat.paused', '일시정지 — 수정 메시지를 입력하면 이어서 실행합니다. 다시 중지하면 취소됩니다.'));
      // Don't auto-hide pause message — it should stay until user acts
    }
  }, [setIsExecuting, clearTodos, isLoading, isPaused, t, sessionIdProp]);

  // Handle keyboard events (arrow up/down history disabled for Electron)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Korean IME guard: Do NOT send during composition (한글 조합 중).
    // Without this check, pressing Enter during IME composition commits the character
    // AND sends the message simultaneously, causing "입력 분할" (input splitting).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
      return;
    }

    // Arrow up/down history navigation disabled for Electron
    // Users can use normal text editing with arrow keys

    if (e.key === 'Escape' && (isLoading || isPaused)) {
      e.preventDefault();
      handleAbort();
    }
  }, [sendMessage, isLoading, isPaused, handleAbort]);

  // Handle paste (HTML table → markdown, image → attachment)
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 1) HTML table → markdown table
    const htmlData = e.clipboardData.getData('text/html');
    if (htmlData && (htmlData.includes('<table') || htmlData.includes('<TABLE'))) {
      const markdownTable = htmlTableToMarkdown(htmlData);
      if (markdownTable) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = input.slice(0, start);
        const after = input.slice(end);
        const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
        const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
        setInput(before + prefix + markdownTable + suffix + after);
        return;
      }
    }

    // 2) Image paste (only when vision model available)
    if (!hasVisionModel) return;
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;

        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            const result = await window.electronAPI?.image?.saveFromClipboard(base64, item.type);
            if (result?.success && result.filePath) {
              setAttachedImages(prev => [...prev, {
                path: result.filePath!,
                preview: dataUrl,
                name: `image.${item.type.split('/')[1] || 'png'}`,
              }]);
            } else {
              window.electronAPI?.log?.error?.('[ChatPanel] Image paste save failed', { error: result?.error });
            }
          } catch (err) {
            window.electronAPI?.log?.error?.('[ChatPanel] Image paste error', { error: err instanceof Error ? err.message : String(err) });
          }
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }, [input, hasVisionModel]);

  // Handle image attachment via file picker
  const handleImageAttach = useCallback(async () => {
    try {
      const result = await window.electronAPI?.image?.selectFile();
      if (result?.success && result.filePath) {
        setAttachedImages(prev => [...prev, {
          path: result.filePath!,
          preview: '', // No preview for file picker images
          name: result.filePath!.split(/[/\\]/).pop() || 'image',
        }]);
      }
    } catch (err) {
      window.electronAPI?.log?.error?.('[ChatPanel] Image file select error', { error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Retry failed tool execution
  const handleToolRetry = useCallback((id: string) => {
    window.electronAPI?.log?.debug('[ChatPanel] Retrying tool', { toolId: id });
  }, []);

  // Compact conversation
  const [isCompacting, setIsCompacting] = useState(false);

  const handleCompact = useCallback(async () => {
    if (!window.electronAPI?.compact || isCompacting || isLoading) return;

    window.electronAPI?.log?.info?.('[ChatPanel] handleCompact START', {
      uiMsgCount: messages.length,
      sessionMsgCount: session?.messages?.length ?? 0,
    });

    // Use session.messages which includes tool messages (not just UI messages)
    // This ensures tool call history is considered for compaction
    // Note: empty array is truthy, so use length check to fall back to UI messages
    const sessionMessages = (session?.messages && session.messages.length > 0) ? session.messages : messages;
    const messagesForCompact = sessionMessages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      tool_calls: (m as any).tool_calls,
      tool_call_id: (m as any).tool_call_id,
    }));

    const checkResult = await window.electronAPI.compact.canCompact(messagesForCompact);

    if (!checkResult.canCompact) {
      const errorMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        role: 'system',
        content: `Compact not possible: ${checkResult.reason}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    setIsCompacting(true);

    try {
      const result = await window.electronAPI.compact.execute(
        messagesForCompact,
        { workingDirectory: currentDirectory },
        sessionIdProp
      );

      if (result.success && result.compactedMessages) {
        // Manual compact: remove the "Please continue your work." message
        // Auto-compact (in ipc-agent) keeps it to resume agent execution
        // Manual compact should wait for user input instead
        const filteredMessages = result.compactedMessages.filter(
          m => !(m.role === 'user' && m.content === 'Please continue your work.')
        );
        const newMessages: ChatMessage[] = filteredMessages.map((m, idx) => ({
          id: `compacted-${Date.now()}-${idx}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          timestamp: Date.now(),
        }));

        newMessages.push({
          id: `compact-info-${Date.now()}`,
          role: 'system',
          content: `Conversation compacted: ${result.originalMessageCount} messages → ${result.newMessageCount} messages`,
          timestamp: Date.now(),
        });

        setIsBatchLoad(true);
        setMessages(newMessages);
        // Clear old tool executions (they're now in the compact summary)
        clearToolExecutions();
        clearTodos();
        clearProgressMessages();
        setTimeout(() => setIsBatchLoad(false), 100);

        if (session && onSessionChange) {
          const updatedSession: Session = {
            ...session,
            messages: newMessages,
            updatedAt: Date.now(),
          };
          onSessionChange(updatedSession);

          if (window.electronAPI?.session) {
            await window.electronAPI.session.save(updatedSession);
          }
        }
      } else {
        const errorMessage: ChatMessage = {
          id: `system-${Date.now()}`,
          role: 'system',
          content: `Compact failed: ${result.error || 'Unknown error'}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      window.electronAPI?.log?.error('[ChatPanel] Compact error', { error: error instanceof Error ? error.message : String(error) });
      const errorMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        role: 'system',
        content: `Compact error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsCompacting(false);
    }
  }, [messages, isCompacting, isLoading, currentDirectory, session, onSessionChange]);

  // Clear chat
  const handleClear = useCallback(async () => {
    window.electronAPI?.log?.info?.('[ChatPanel] handleClear called', { isLoading, sessionId: session?.id, msgCount: messages.length });
    if (isLoading && window.electronAPI?.agent) {
      window.electronAPI?.log?.info?.('[ChatPanel] Aborting agent before clear');
      await window.electronAPI.agent.abort(sessionIdProp);
    }

    // Skip session load effect to prevent overwriting our cleared message
    // Keep it true until all session changes settle (prevents flickering)
    skipSessionLoadRef.current = true;

    setIsBatchLoad(true);
    setMessages([
      {
        id: 'cleared',
        role: 'system',
        content: t('chat.chatCleared'),
        timestamp: Date.now(),
      },
    ]);
    setTimeout(() => setIsBatchLoad(false), 100);

    // Reset main process state (context tracker, todos, approved tools)
    await window.electronAPI?.agent?.clearState?.(sessionIdProp);

    // Clear execution state — use correct method based on whether this is the active tab.
    // If active tab: clear global state (currently displayed data)
    // If background tab: clear the session cache (not the displayed data of another tab)
    if (isActiveProp) {
      clearTodos();
      clearProgressMessages();
      clearToolExecutions();
    } else if (sessionIdProp) {
      clearSessionCache(sessionIdProp);
    }
    setIsExecuting(false);
    setIsLoading(false);
    setIsPaused(false);
    setAbortMessage(null);
    setAttachedImages([]);

    if (session && onSessionChange) {
      const clearedSession: Session = {
        ...session,
        messages: [],
        updatedAt: Date.now(),
      };
      onSessionChange(clearedSession);

      if (window.electronAPI?.session) {
        await window.electronAPI.session.save(clearedSession);
      }
    }

    // DO NOT call onClearSession here - it creates a circular call loop:
    // BottomPanel click → onClearSession → App.handleClearSession → chatPanelRef.clear()
    // → handleClear → onClearSession() → handleClearSession → clear() → infinite loop
    // The parent already knows about the clear since it initiated it via ref.

    // Reset skipSessionLoadRef after a delay to allow session state changes to settle
    setTimeout(() => {
      skipSessionLoadRef.current = false;
    }, 500);
  }, [session, onSessionChange, isLoading, clearTodos, clearProgressMessages, clearToolExecutions, clearSessionCache, isActiveProp, sessionIdProp, setIsExecuting, t]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    clear: handleClear,
    compact: handleCompact,
  }), [handleClear, handleCompact]);

  return (
    <div className="chat-panel" role="region" aria-label="Chat Assistant">
      {/* User Question Dialog */}
      <UserQuestion
        isOpen={isQuestionOpen}
        question={currentQuestion}
        onAnswer={handleQuestionAnswer}
        onCancel={handleQuestionCancel}
      />

      {/* Approval Modal (Supervised Mode) */}
      <ApprovalModal
        isOpen={isApprovalOpen}
        toolName={approvalRequest?.toolName || ''}
        args={approvalRequest?.args || {}}
        reason={approvalRequest?.reason}
        onResponse={handleApprovalResponse}
        onCancel={handleApprovalCancel}
      />

      {/* Current Directory Info */}
      <div className="chat-directory-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span>{currentDirectory || t('chat.noDirectory')}</span>
        {currentDirectory && (
          <button
            className="directory-open-btn"
            onClick={() => window.electronAPI?.shell?.openPath(currentDirectory)}
            title={t('chat.openExplorer')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
            </svg>
          </button>
        )}
        <button
          className="directory-open-btn directory-change-btn"
          onClick={onChangeDirectory}
          title={t('chat.changeDir')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM12.5 10l-5 4.5 1.41 1.41L11.5 13.5V18h2v-4.5l2.59 2.41L17.5 14.5z"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        {/* Show earlier messages button */}
        {hasHiddenMessages && (
          <button
            className="show-earlier-btn"
            onClick={() => setShowAllMessages(true)}
            title={t('chat.showEarlier', { count: hiddenMessageCount })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
            </svg>
            {t('chat.showEarlier', { count: hiddenMessageCount })}
          </button>
        )}
        {/* Unified timeline: messages and tool executions interleaved by timestamp */}
        {timeline.map((item, idx) => {
          if (item.type === 'message') {
            return (
              <MessageItem
                key={item.data.id}
                message={item.data}
                isBatchLoad={isBatchLoad}
              />
            );
          } else {
            // Tool executions group
            return (
              <ToolExecution
                key={`tools-${idx}`}
                executions={item.data}
                onRetry={handleToolRetry}
              />
            );
          }
        })}

        {/* TODO List is now shown in the Editor area (TodoPanel) */}

        {/* Progress Messages - shown during execution */}
        {progressMessages.length > 0 && (
          <ProgressMessage
            messages={progressMessages}
            onDismiss={dismissProgressMessage}
          />
        )}

        {isCompacting && (
          <div className="chat-message system">
            <div className="message-content">
              <div className="typing-indicator" style={{ display: 'inline-flex', marginRight: '8px' }}>
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span>{t('chat.compacting')}</span>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="chat-message assistant loading">
            <div className="message-avatar">
              <img src={logoImage} alt="Assistant" width="18" height="18" />
            </div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        {/* Abort Message */}
        {abortMessage && (
          <div className="chat-message system abort-message">
            <div className="message-content">
              <p>{abortMessage}</p>
            </div>
          </div>
        )}
        {/* Countdown display during 2-minute wait */}
        {countdownSeconds !== null && countdownSeconds > 0 && (
          <div className="retry-countdown-bar">
            LLM 서버 응답 대기 중... {countdownSeconds}초 남음
          </div>
        )}

        {/* Retry button after LLM retry exhausted */}
        {retryableError && (
          <div className="retry-error-bar">
            <button className="retry-btn" onClick={handleRetry}>
              재시도
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <div className="chat-input-container" role="form" aria-label="Message input">
        {/* Image Preview Thumbnails */}
        {attachedImages.length > 0 && (
          <div className="chat-image-previews">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="image-preview-item">
                {img.preview ? (
                  <img src={img.preview} alt={img.name} className="image-preview-thumb" />
                ) : (
                  <div className="image-preview-placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                    </svg>
                  </div>
                )}
                <span className="image-preview-name" title={img.name}>{img.name}</span>
                <button
                  className="image-preview-remove"
                  onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                  title={t('chat.removeImage')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-wrapper">
          <span className="chat-input-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z"/>
            </svg>
          </span>
          <textarea
            ref={inputRef}
            className={`chat-input${hasVisionModel ? ' has-attach' : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t('chat.inputPlaceholder')}
            rows={1}
            disabled={isLoading}
            aria-label={t('chat.inputPlaceholder')}
            aria-describedby="chat-input-hint"
          />
          <span id="chat-input-hint" className="sr-only">{t('chat.inputHint')}</span>
          <div className="chat-input-actions-right">
            {hasVisionModel && (
              <button
                className="chat-attach-btn"
                onClick={handleImageAttach}
                disabled={isLoading}
                title={t('chat.attachImage')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                </svg>
              </button>
            )}
            {isLoading ? (
              <button
                className="chat-send-btn chat-abort-btn"
                onClick={handleAbort}
                title={t('chat.stop')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              </button>
            ) : isPaused ? (
              <>
                <button
                  className="chat-send-btn chat-abort-paused"
                  onClick={handleAbort}
                  title={t('chat.stopFull', '완전 중지')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
                <button
                  className="chat-send-btn chat-resume-btn"
                  onClick={sendMessage}
                  disabled={!input.trim() && attachedImages.length === 0}
                  title={t('chat.resume', '수정 후 이어서 실행')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
                  </svg>
                </button>
              </>
            ) : (
              <button
                className="chat-send-btn"
                onClick={sendMessage}
                disabled={(!input.trim() && attachedImages.length === 0) || isLoading}
                title={t('chat.send')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="chat-input-hints">
          <span className="chat-input-hint">{t('chat.inputHint')}</span>
          <button
            className={`permission-toggle ${allowAllPermissions ? 'on' : 'off'}`}
            onClick={() => onAllowAllPermissionsChange?.(!allowAllPermissions)}
            title={allowAllPermissions ? t('chat.autoMode') : t('chat.supervisedMode')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              {allowAllPermissions ? (
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
              ) : (
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
              )}
            </svg>
            <span>{allowAllPermissions ? t('chat.auto') : t('chat.supervised')}</span>
          </button>
        </div>
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

export default ChatPanel;
