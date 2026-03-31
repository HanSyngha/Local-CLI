/**
 * Agent Context - Isolates tool execution state from ChatPanel
 *
 * Performance optimization:
 * - Tool executions and progress messages are now in separate context
 * - ChatPanel doesn't re-render when only tool state changes
 * - Components that need tool state subscribe independently
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AskUserResponse } from '../../../preload/index';
import type { ToolExecutionData, ToolCategory } from '../components/ToolExecution';
import type { ProgressMessageData } from '../components/ProgressMessage';
import type { TodoItem } from '../components/TodoList';

// Helper function to determine tool category
const getToolCategory = (toolName: string): ToolCategory => {
  const name = toolName.toLowerCase();
  if (name.includes('file') || name.includes('read') || name.includes('write') || name.includes('edit')) return 'file';
  if (name.includes('shell') || name.includes('powershell') || name.includes('command')) return 'shell';
  if (name.includes('browser') || name.includes('chrome') || name.includes('cdp')) return 'browser';
  if (name.includes('excel') || name.includes('word') || name.includes('powerpoint') || name.includes('office')) return 'office';
  if (name.includes('user') || name.includes('ask') || name.includes('tell')) return 'user';
  if (name.includes('todo')) return 'todo';
  if (name.includes('docs') || name.includes('documentation') || name.includes('search_agent')) return 'docs';
  return 'other';
};

// Sanitize string value by removing XML-like parameter syntax from display
const sanitizeDisplayString = (value: string): string => {
  if (typeof value !== 'string') return value;

  // Remove XML parameter tags: <parameter name="...">
  let sanitized = value.replace(/<parameter\s+name=["'][^"']*["']>/gi, '');

  // Remove closing parameter tags
  sanitized = sanitized.replace(/<\/parameter>/gi, '');

  // Remove truncated XML fragments like: font_name">value or text">value
  sanitized = sanitized.replace(/^[a-z_]+["']?>/i, '');

  // Clean up any remaining XML-like artifacts
  sanitized = sanitized.replace(/^["']?>/, '');

  return sanitized.trim();
};

// User Question Data
export interface UserQuestionData {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  allowCustom: boolean;
  reqId?: string; // Worker round-trip ID for askUser response routing
  sessionId?: string; // Session that sent this question (for routing response to correct worker)
}

// Approval Request
export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  reason?: string;
  sessionId?: string; // Session that sent this request (for routing response to correct worker)
}

// Final response callback type
export type FinalResponseCallback = (message: string) => void;

interface AgentContextValue {
  // Tool executions
  toolExecutions: ToolExecutionData[];
  clearToolExecutions: () => void;
  restoreToolExecutions: (tools: ToolExecutionData[]) => void;

  // Session-aware state switching
  switchSession: (newSessionId: string | null) => void;
  clearSessionCache: (sessionId: string) => void;

  // Progress messages
  progressMessages: ProgressMessageData[];
  dismissProgressMessage: (id: string) => void;
  clearProgressMessages: () => void;

  // TODOs
  todos: TodoItem[];
  clearTodos: () => void;

  // Execution state
  isExecuting: boolean;
  setIsExecuting: (value: boolean) => void;

  // User question
  currentQuestion: UserQuestionData | null;
  isQuestionOpen: boolean;
  handleQuestionAnswer: (questionId: string, answer: string, isCustom: boolean) => Promise<void>;
  handleQuestionCancel: () => Promise<void>;

  // Approval modal
  approvalRequest: ApprovalRequest | null;
  isApprovalOpen: boolean;
  handleApprovalResponse: (result: 'approve' | 'always' | { reject: true; comment: string }) => Promise<void>;
  handleApprovalCancel: () => Promise<void>;

  // Final response callback (for displaying in chat instead of tool box)
  onFinalResponse: FinalResponseCallback | null;
  setOnFinalResponse: (callback: FinalResponseCallback | null) => void;

  // Setup listeners (call once from parent)
  setupAgentListeners: () => () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  // Tool executions - immediate updates (removed batching to fix visibility issues)
  const [toolExecutions, setToolExecutions] = useState<ToolExecutionData[]>([]);
  // Keep ref for stable access in callbacks
  const toolExecutionsRef = useRef<ToolExecutionData[]>([]);

  // Sync ref with state
  useEffect(() => {
    toolExecutionsRef.current = toolExecutions;
  }, [toolExecutions]);

  // Per-session cache for tool executions, todos, progress
  const toolCacheRef = useRef<Map<string, ToolExecutionData[]>>(new Map());
  const todoCacheRef = useRef<Map<string, TodoItem[]>>(new Map());
  const progressCacheRef = useRef<Map<string, ProgressMessageData[]>>(new Map());
  const activeSessionRef = useRef<string | null>(null);

  // Progress messages
  const [progressMessages, setProgressMessages] = useState<ProgressMessageData[]>([]);
  const progressMessagesRef = useRef<ProgressMessageData[]>([]);
  useEffect(() => { progressMessagesRef.current = progressMessages; }, [progressMessages]);

  // TODOs
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const todosRef = useRef<TodoItem[]>([]);
  useEffect(() => { todosRef.current = todos; }, [todos]);

  // Execution state — stored as ref to prevent cross-tab re-renders.
  // When Session A sets isExecuting(true), it must NOT cause Session B's ChatPanel
  // (where the user is typing) to re-render, which would break Korean IME composition.
  // Each ChatPanel has its own `isLoading` local state for UI rendering.
  const isExecutingRef = useRef(false);
  const setIsExecuting = useCallback((value: boolean) => {
    isExecutingRef.current = value;
  }, []);

  // User question state
  const [currentQuestion, setCurrentQuestion] = useState<UserQuestionData | null>(null);
  const [isQuestionOpen, setIsQuestionOpen] = useState(false);
  const currentQuestionRef = useRef<UserQuestionData | null>(null);
  const isQuestionOpenRef = useRef(false);
  useEffect(() => { currentQuestionRef.current = currentQuestion; }, [currentQuestion]);
  useEffect(() => { isQuestionOpenRef.current = isQuestionOpen; }, [isQuestionOpen]);

  // Approval modal state
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const approvalRequestRef = useRef<ApprovalRequest | null>(null);
  const isApprovalOpenRef = useRef(false);
  useEffect(() => { approvalRequestRef.current = approvalRequest; }, [approvalRequest]);
  useEffect(() => { isApprovalOpenRef.current = isApprovalOpen; }, [isApprovalOpen]);

  // Modal queue: When a question/approval arrives while another modal is open,
  // queue it instead of overwriting. Prevents concurrent sessions from losing requests.
  type PendingModal =
    | { type: 'question'; data: UserQuestionData }
    | { type: 'approval'; data: ApprovalRequest };
  const pendingModalQueueRef = useRef<PendingModal[]>([]);
  const isModalActiveRef = useRef(false);

  // Show next queued modal (called after current modal is dismissed)
  const showNextQueuedModal = useCallback(() => {
    const next = pendingModalQueueRef.current.shift();
    if (next) {
      if (next.type === 'question') {
        setCurrentQuestion(next.data);
        setIsQuestionOpen(true);
        // isModalActiveRef stays true
      } else {
        setApprovalRequest(next.data);
        setIsApprovalOpen(true);
        // isModalActiveRef stays true
      }
    } else {
      isModalActiveRef.current = false;
    }
  }, []);

  // Final response callback (stored in ref to avoid stale closures)
  const finalResponseCallbackRef = useRef<FinalResponseCallback | null>(null);
  const setOnFinalResponse = useCallback((callback: FinalResponseCallback | null) => {
    finalResponseCallbackRef.current = callback;
  }, []);

  // Add tool execution immediately (no batching - fixes visibility issues during resize)
  const addToolExecution = useCallback((execution: ToolExecutionData) => {
    setToolExecutions(prev => [...prev, execution]);
  }, []);

  // Restore tool executions from session (for session load/restore)
  const restoreToolExecutions = useCallback((tools: ToolExecutionData[]) => {
    setToolExecutions(tools);
    toolExecutionsRef.current = tools;
  }, []);

  // Clear functions
  const clearToolExecutions = useCallback(() => {
    window.electronAPI?.log?.debug?.('[AgentContext] clearToolExecutions');
    setToolExecutions([]);
    toolExecutionsRef.current = [];
  }, []);

  const clearProgressMessages = useCallback(() => {
    window.electronAPI?.log?.debug?.('[AgentContext] clearProgressMessages');
    setProgressMessages([]);
    progressMessagesRef.current = [];
  }, []);

  const clearTodos = useCallback(() => {
    window.electronAPI?.log?.debug?.('[AgentContext] clearTodos');
    setTodos([]);
    todosRef.current = [];
  }, []);

  const dismissProgressMessage = useCallback((id: string) => {
    setProgressMessages(prev => prev.filter(msg => msg.id !== id));
  }, []);

  // Switch session: save current state to cache, restore new session's state from cache
  // Uses refs to avoid stale closure issues (this callback must be stable)
  const switchSession = useCallback((newSessionId: string | null) => {
    const oldId = activeSessionRef.current;

    // Save current state to old session cache (read from refs for latest values)
    if (oldId) {
      toolCacheRef.current.set(oldId, toolExecutionsRef.current);
      todoCacheRef.current.set(oldId, todosRef.current);
      progressCacheRef.current.set(oldId, progressMessagesRef.current);
    }

    // Restore from new session cache (or empty for new session)
    const cachedTools = newSessionId ? toolCacheRef.current.get(newSessionId) || [] : [];
    const cachedTodos = newSessionId ? todoCacheRef.current.get(newSessionId) || [] : [];
    const cachedProgress = newSessionId ? progressCacheRef.current.get(newSessionId) || [] : [];

    setToolExecutions(cachedTools);
    toolExecutionsRef.current = cachedTools;
    setTodos(cachedTodos);
    todosRef.current = cachedTodos;
    setProgressMessages(cachedProgress);
    progressMessagesRef.current = cachedProgress;

    activeSessionRef.current = newSessionId;

    window.electronAPI?.log?.debug?.('[AgentContext] switchSession', {
      from: oldId, to: newSessionId,
      restoredTools: cachedTools.length,
      restoredTodos: cachedTodos.length,
    });
  }, []); // No deps - all reads from refs

  // Clear session cache when a tab is closed (prevent memory leak)
  const clearSessionCache = useCallback((sessionId: string) => {
    toolCacheRef.current.delete(sessionId);
    todoCacheRef.current.delete(sessionId);
    progressCacheRef.current.delete(sessionId);
    window.electronAPI?.log?.debug?.('[AgentContext] clearSessionCache', { sessionId });
  }, []);

  // User question handlers
  // Use stored sessionId from the question (not activeSessionRef) to route response to correct worker
  const handleQuestionAnswer = useCallback(async (questionId: string, answer: string, isCustom: boolean) => {
    window.electronAPI?.log?.debug('[AgentContext] Question answered', { questionId, answer, isCustom });
    const currentReqId = currentQuestion?.reqId;
    const originSessionId = currentQuestion?.sessionId || activeSessionRef.current;
    setIsQuestionOpen(false);
    setCurrentQuestion(null);

    if (window.electronAPI?.agent) {
      const response: AskUserResponse & { reqId?: string; sessionId?: string } = isCustom
        ? {
            selectedOption: { label: 'Other', value: 'other' },
            isOther: true,
            customText: answer,
          }
        : {
            selectedOption: { label: answer, value: answer },
            isOther: false,
          };
      if (currentReqId) response.reqId = currentReqId;
      if (originSessionId) response.sessionId = originSessionId;
      await window.electronAPI.agent.respondToQuestion(response, originSessionId || undefined);
    }
    // Show next queued modal if any
    showNextQueuedModal();
  }, [currentQuestion, showNextQueuedModal]);

  const handleQuestionCancel = useCallback(async () => {
    const currentReqId = currentQuestion?.reqId;
    const originSessionId = currentQuestion?.sessionId || activeSessionRef.current;
    setIsQuestionOpen(false);
    setCurrentQuestion(null);

    if (window.electronAPI?.agent) {
      const response: AskUserResponse & { reqId?: string; sessionId?: string } = {
        selectedOption: { label: 'Cancel', value: 'cancel' },
        isOther: true,
        customText: 'User cancelled',
      };
      if (currentReqId) response.reqId = currentReqId;
      if (originSessionId) response.sessionId = originSessionId;
      await window.electronAPI.agent.respondToQuestion(response, originSessionId || undefined);
    }
    // Show next queued modal if any
    showNextQueuedModal();
  }, [currentQuestion, showNextQueuedModal]);

  // Approval handlers
  // Use stored sessionId from the approval request (not activeSessionRef) to route to correct worker
  const handleApprovalResponse = useCallback(async (result: 'approve' | 'always' | { reject: true; comment: string }) => {
    if (!approvalRequest || !window.electronAPI?.agent?.respondToApproval) return;

    const originSessionId = approvalRequest.sessionId || activeSessionRef.current;
    setIsApprovalOpen(false);

    await window.electronAPI.agent.respondToApproval({
      id: approvalRequest.id,
      result,
      sessionId: originSessionId || undefined,
    });

    setApprovalRequest(null);
    // Show next queued modal if any
    showNextQueuedModal();
  }, [approvalRequest, showNextQueuedModal]);

  const handleApprovalCancel = useCallback(async () => {
    if (!approvalRequest || !window.electronAPI?.agent?.respondToApproval) return;

    const originSessionId = approvalRequest.sessionId || activeSessionRef.current;
    setIsApprovalOpen(false);

    await window.electronAPI.agent.respondToApproval({
      id: approvalRequest.id,
      result: { reject: true, comment: 'Cancelled by user' },
      sessionId: originSessionId || undefined,
    });

    setApprovalRequest(null);
    // Show next queued modal if any
    showNextQueuedModal();
  }, [approvalRequest, showNextQueuedModal]);

  // Setup agent event listeners — registered ONCE in AgentProvider (not per ChatPanel).
  // Events from worker threads include `sessionId` in data.
  // We route events to the active session's state. Background session events go to cache.
  useEffect(() => {
    if (!window.electronAPI?.agent) return;

    const unsubscribes: Array<() => void> = [];

    // Helper: check if event is for the active session
    const isActiveSession = (data: { sessionId?: string }): boolean => {
      // If no sessionId in data, it's from legacy single-session mode — always active
      if (!data.sessionId) return true;
      return data.sessionId === activeSessionRef.current;
    };

    // Helper: add tool execution to background cache if not active session
    const addToolToBackground = (sessionId: string, execution: ToolExecutionData) => {
      const cache = toolCacheRef.current.get(sessionId) || [];
      cache.push(execution);
      toolCacheRef.current.set(sessionId, cache);
    };

    // Tool call event - immediate update (skip final_response)
    unsubscribes.push(
      window.electronAPI.agent.onToolCall((data) => {
        // Skip final_response - it will be handled as a chat message
        if (data.toolName === 'final_response') return;

        window.electronAPI?.log?.debug?.('[AgentContext] Tool call', { toolName: data.toolName, sessionId: (data as any).sessionId });
        const toolCategory = getToolCategory(data.toolName);

        // Sanitize the reason to remove any XML-like artifacts
        const rawReason = data.args?.reason ? String(data.args.reason) : undefined;
        const sanitizedReason = rawReason ? sanitizeDisplayString(rawReason) : undefined;

        const newExecution: ToolExecutionData = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${data.toolName}`,
          toolName: data.toolName,
          category: toolCategory,
          input: data.args,
          status: 'running',
          timestamp: Date.now(),
          reason: sanitizedReason,
        };

        if (isActiveSession(data as any)) {
          addToolExecution(newExecution);
        } else if ((data as any).sessionId) {
          addToolToBackground((data as any).sessionId, newExecution);
        }
      })
    );

    // Tool result event - update existing execution
    unsubscribes.push(
      window.electronAPI.agent.onToolResult((data) => {
        window.electronAPI?.log?.debug?.('[AgentContext] Tool result', { toolName: data.toolName, success: data.success });
        // Handle final_response specially - display as chat message
        if (data.toolName === 'final_response' && data.success && data.result) {
          if (finalResponseCallbackRef.current && isActiveSession(data as any)) {
            finalResponseCallbackRef.current(data.result);
          }
          return;
        }

        // Update in active or background cache
        if (isActiveSession(data as any)) {
          setToolExecutions(prev => {
            const updated = [...prev];
            const lastIdx = updated.findLastIndex(t => t.toolName === data.toolName && t.status === 'running');
            if (lastIdx !== -1) {
              const startTime = updated[lastIdx].timestamp;
              updated[lastIdx] = {
                ...updated[lastIdx],
                status: data.success ? 'success' : 'error',
                output: data.success ? data.result : undefined,
                error: data.success ? undefined : data.result,
                duration: Date.now() - startTime,
              };
            }
            return updated;
          });
        } else if ((data as any).sessionId) {
          const sid = (data as any).sessionId;
          const cache = toolCacheRef.current.get(sid) || [];
          const lastIdx = cache.findLastIndex(t => t.toolName === data.toolName && t.status === 'running');
          if (lastIdx !== -1) {
            cache[lastIdx] = {
              ...cache[lastIdx],
              status: data.success ? 'success' : 'error',
              output: data.success ? data.result : undefined,
              error: data.success ? undefined : data.result,
              duration: Date.now() - cache[lastIdx].timestamp,
            };
            toolCacheRef.current.set(sid, cache);
          }
        }
      })
    );

    // Sub-agent phase event — update the running tool's phase info
    if (window.electronAPI.agent.onSubAgentPhase) {
      unsubscribes.push(
        window.electronAPI.agent.onSubAgentPhase((data) => {
          setToolExecutions(prev => {
            const updated = [...prev];
            const lastRunning = updated.findLastIndex(t => t.status === 'running');
            if (lastRunning !== -1) {
              updated[lastRunning] = {
                ...updated[lastRunning],
                subAgentPhase: data.phase,
                subAgentDetail: data.detail,
              };
            }
            return updated;
          });
        })
      );
    }

    // TODO update event — sessionId passed as second arg from WorkerManager
    unsubscribes.push(
      window.electronAPI.agent.onTodoUpdate((agentTodos, eventSessionId?: string) => {
        window.electronAPI?.log?.debug?.('[AgentContext] Todo update', { count: agentTodos.length, sessionId: eventSessionId });
        const uiTodos: TodoItem[] = agentTodos.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
        }));

        const isActive = !eventSessionId || eventSessionId === activeSessionRef.current;
        if (isActive) {
          setTodos(uiTodos);
        } else {
          // Background session — save to cache for restoration on tab switch
          todoCacheRef.current.set(eventSessionId, uiTodos);
        }
      })
    );

    // Tell user event - log only, not displayed in tool execution history
    unsubscribes.push(
      window.electronAPI.agent.onTellUser((message) => {
        window.electronAPI?.log?.debug?.('[AgentContext] Tell user', { msgLength: message.length });
      })
    );

    // Ask user event (includes sessionId + reqId from worker for round-trip routing)
    // Uses modal queue to prevent concurrent sessions from overwriting each other's requests
    unsubscribes.push(
      window.electronAPI.agent.onAskUser((request) => {
        const reqAny = request as unknown as Record<string, unknown>;
        const eventSessionId = reqAny.sessionId as string | undefined;
        window.electronAPI?.log?.info?.('[AgentContext] Ask user', {
          question: request.question,
          optionCount: request.options?.length ?? 0,
          sessionId: eventSessionId,
          modalActive: isModalActiveRef.current,
        });
        const questionData: UserQuestionData = {
          id: `question-${Date.now()}`,
          question: request.question,
          options: (request.options || []).map((opt: unknown, idx: number) => ({
            id: `option-${idx}`,
            label: typeof opt === 'string' ? opt : (opt as { label: string }).label,
          })),
          allowCustom: request.allowCustom ?? true,
          reqId: reqAny.reqId as string | undefined,
          sessionId: eventSessionId,
        };
        if (isModalActiveRef.current) {
          // Another modal is already showing — queue this request
          pendingModalQueueRef.current.push({ type: 'question', data: questionData });
          window.electronAPI?.log?.info?.('[AgentContext] Question QUEUED (modal busy)', { sessionId: eventSessionId, queueLen: pendingModalQueueRef.current.length });
        } else {
          isModalActiveRef.current = true;
          setCurrentQuestion(questionData);
          setIsQuestionOpen(true);
        }
      })
    );

    // Approval request event (includes sessionId from worker)
    // Uses modal queue to prevent concurrent sessions from overwriting each other's requests
    if (window.electronAPI.agent.onApprovalRequest) {
      unsubscribes.push(
        window.electronAPI.agent.onApprovalRequest((request) => {
          const reqAny = request as unknown as Record<string, unknown>;
          const eventSessionId = reqAny.sessionId as string | undefined;
          window.electronAPI?.log?.info?.('[AgentContext] Approval request', {
            toolName: request.toolName,
            reason: request.reason,
            sessionId: eventSessionId,
            modalActive: isModalActiveRef.current,
          });
          const approvalData: ApprovalRequest = {
            ...request,
            sessionId: eventSessionId,
          };
          if (isModalActiveRef.current) {
            // Another modal is already showing — queue this request
            pendingModalQueueRef.current.push({ type: 'approval', data: approvalData });
            window.electronAPI?.log?.info?.('[AgentContext] Approval QUEUED (modal busy)', { sessionId: eventSessionId, queueLen: pendingModalQueueRef.current.length });
          } else {
            isModalActiveRef.current = true;
            setApprovalRequest(approvalData);
            setIsApprovalOpen(true);
          }
        })
      );
    }

    // Worker crash/terminate modal cleanup: dismiss modals belonging to crashed session
    // and remove queued modals for that session
    // Worker crash/terminate: dismiss modals belonging to crashed session + clean queue
    const handleSessionDismiss = (crashedSessionId: string | undefined) => {
      if (!crashedSessionId) return;
      // Remove all queued modals for the crashed session
      pendingModalQueueRef.current = pendingModalQueueRef.current.filter(
        m => (m.data as { sessionId?: string }).sessionId !== crashedSessionId
      );
      // If current question modal belongs to crashed session, close it
      if (isModalActiveRef.current && isQuestionOpenRef.current) {
        if (currentQuestionRef.current?.sessionId === crashedSessionId) {
          setIsQuestionOpen(false);
          setCurrentQuestion(null);
          showNextQueuedModal();
          return;
        }
      }
      // If current approval modal belongs to crashed session, close it
      if (isModalActiveRef.current && isApprovalOpenRef.current) {
        if (approvalRequestRef.current?.sessionId === crashedSessionId) {
          setIsApprovalOpen(false);
          setApprovalRequest(null);
          showNextQueuedModal();
        }
      }
    };

    if (window.electronAPI.agent.onAskUserResolved) {
      unsubscribes.push(
        window.electronAPI.agent.onAskUserResolved((data) => handleSessionDismiss(data?.sessionId))
      );
    }
    if ((window.electronAPI.agent as any).onApprovalResolved) {
      unsubscribes.push(
        (window.electronAPI.agent as any).onApprovalResolved((data?: { sessionId?: string }) =>
          handleSessionDismiss(data?.sessionId)
        )
      );
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [addToolExecution, showNextQueuedModal]); // addToolExecution is stable (useCallback with [])

  // Kept for backward compatibility but now a no-op (listeners are set up in useEffect above)
  const setupAgentListeners = useCallback(() => {
    return () => {};
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<AgentContextValue>(() => ({
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
    isExecuting: isExecutingRef.current,
    setIsExecuting,
    currentQuestion,
    isQuestionOpen,
    handleQuestionAnswer,
    handleQuestionCancel,
    approvalRequest,
    isApprovalOpen,
    handleApprovalResponse,
    handleApprovalCancel,
    onFinalResponse: finalResponseCallbackRef.current,
    setOnFinalResponse,
    setupAgentListeners,
  }), [
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
    currentQuestion,
    isQuestionOpen,
    handleQuestionAnswer,
    handleQuestionCancel,
    approvalRequest,
    isApprovalOpen,
    handleApprovalResponse,
    handleApprovalCancel,
    setOnFinalResponse,
    setupAgentListeners,
  ]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}

// Selective hooks for components that only need specific state
export function useToolExecutions() {
  const { toolExecutions, clearToolExecutions } = useAgent();
  return { toolExecutions, clearToolExecutions };
}

export function useProgressMessages() {
  const { progressMessages, dismissProgressMessage, clearProgressMessages } = useAgent();
  return { progressMessages, dismissProgressMessage, clearProgressMessages };
}

export function useTodos() {
  const { todos, clearTodos } = useAgent();
  return { todos, clearTodos };
}

export function useExecutionState() {
  const { isExecuting, setIsExecuting } = useAgent();
  return { isExecuting, setIsExecuting };
}

export default AgentContext;
