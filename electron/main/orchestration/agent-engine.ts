/**
 * Agent Engine - Electron-free core agent execution logic
 *
 * Extracted from ipc-agent.ts to enable usage in both:
 * - Main process (via BrowserWindow-based AgentIO)
 * - Worker threads (via parentPort-based AgentIO)
 *
 * This module has NO electron imports. All window/IPC operations
 * are abstracted through the AgentIO interface.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { llmClient, Message } from '../core/llm';
import { logger } from '../utils/logger';
import { reportError, updateRecentMessagesForTelemetry } from '../core/telemetry/error-reporter';
import { detectGitRepo } from '../utils/git-utils';
import { toolRegistry, executeSimpleTool } from '../tools';
import { executeAgentTool } from '../tools/llm/simple/simple-tool-executor';
import { isLLMAgentTool } from '../tools/types';
import {
  setWorkingDirectory,
  setPowerShellWorkingDirectory,
  setTodoWriteCallback,
  setTellToUserCallback,
  setAskUserCallback,
  setGetTodosCallback,
  setFinalResponseCallback,
  clearFinalResponseCallbacks,
  setToolExecutionCallback,
  setToolResponseCallback,
} from '../tools';
import { setReasoningCallback, setToolApprovalCallback, requestToolApproval } from '../tools/llm/simple/simple-tool-executor';
import { setSubAgentPhaseLogger } from '../agents/common/sub-agent';
import type { ToolApprovalResult } from '../tools/llm/simple/simple-tool-executor';
import { ContextLengthError, QuotaExceededError, LLMRetryExhaustedError, APIError } from '../errors';
import { buildPlanExecutePrompt, getCriticalReminders, VISION_VERIFICATION_RULE } from '../prompts';
import { GIT_COMMIT_RULES } from '../prompts/shared/git-rules';
import { PlanningLLM } from '../agents/planner';
import { contextTracker, getContextTracker } from '../core/compact';
import { configManager } from '../core/config';
import {
  validateToolMessages,
  truncateMessages,
  buildTodoContext,
  flattenMessagesToHistory,
  parseToolArguments,
} from './utils';
import { compactConversation } from '../core/compact';
import { handleTodoCompleteAutoSync, buildCompactHistory } from '../core/background-sync';
import type { TodoItem, AskUserRequest, AskUserResponse } from './types';

// =============================================================================
// Types
// =============================================================================

export interface AgentConfig {
  enabledToolGroups?: string[];
  workingDirectory?: string;
  enablePlanning?: boolean;
  resumeTodos?: boolean;
  autoMode?: boolean;
}

export interface AgentCallbacks {
  onMessage?: (message: Message) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: string, success: boolean) => void;
  onToolExecution?: (toolName: string, reason: string, args: Record<string, unknown>) => void;
  onToolResponse?: (toolName: string, success: boolean, result: string) => void;
  onTodoUpdate?: (todos: TodoItem[]) => void;
  onTellUser?: (message: string) => void;
  onAskUser?: (request: AskUserRequest) => Promise<AskUserResponse>;
  onStreamChunk?: (chunk: string) => void;
  onComplete?: (response: string) => void;
  onError?: (error: Error) => void;
}

export interface AgentResult {
  success: boolean;
  response: string;
  messages: Message[];
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
  }>;
  iterations: number;
  error?: string;
}

// =============================================================================
// AgentIO - Abstraction over BrowserWindow/IPC
// =============================================================================

export interface AgentIO {
  /** Send IPC message to renderer (replaces broadcastToWindows) */
  broadcast(channel: string, ...data: unknown[]): void;
  /** Flash taskbar on windows for user attention */
  flashWindows(): void;
  /** Show task window */
  showTaskWindow(): void;
  /** Check if task window is visible */
  isTaskWindowVisible(): boolean;
  /** Request tool approval from user (Supervised Mode) - returns Promise that resolves on user response */
  requestApproval(toolName: string, args: Record<string, unknown>, reason?: string): Promise<ToolApprovalResult>;
  /** Send file edit preview to renderer */
  sendFileEdit(data: { path: string; originalContent: string; newContent: string; language: string }): void;
}

// =============================================================================
// AgentRunState - Per-session mutable state
// =============================================================================

export interface AgentRunState {
  isRunning: boolean;
  runId: number;
  abortController: AbortController | null;
  currentTodos: TodoItem[];
  alwaysApprovedTools: Set<string>;
  currentSessionId: string | null;
  /** Messages from paused run — restored on resume to maintain context */
  pausedMessages?: Message[];
}

// Tools that don't require approval (communication tools, not action tools)
export const NO_APPROVAL_TOOLS = new Set([
  'tell_to_user',
  'ask_to_user',
  'final_response',
  'write_todos',
  'update_todos',
  'get_todo_list',
]);

// =============================================================================
// System Prompt Builder (CLI parity: plan-executor.ts buildSystemPrompt)
// =============================================================================

function getWindowsDesktopPath(): string | undefined {
  const userProfile = process.env['USERPROFILE'];
  if (userProfile) return `${userProfile}\\Desktop`;
  return undefined;
}

function buildSystemPrompt(workingDirectory: string): string {
  const isGitRepo = detectGitRepo(workingDirectory);
  const hasVision = toolRegistry.isToolGroupEnabled('vision');
  const windowsDesktopPath = getWindowsDesktopPath();

  const toolSummary = toolRegistry.getToolSummaryForPlanning();
  let prompt = buildPlanExecutePrompt({ toolSummary, workingDirectory, windowsDesktopPath });

  if (isGitRepo) {
    prompt += `\n\n${GIT_COMMIT_RULES}`;
    logger.debug('Git repo detected - added GIT_COMMIT_RULES to prompt');
  }

  if (hasVision) {
    prompt += `\n\n${VISION_VERIFICATION_RULE}`;
    logger.debug('Vision model available - added VISION_VERIFICATION_RULE to prompt');
  }

  return prompt;
}

// =============================================================================
// Safe CWD (prevent crashes in read-only directories like Program Files)
// =============================================================================

function getSafeDefaultCwd(): string {
  const cwd = process.cwd();
  const lower = cwd.toLowerCase();
  const tempDir = (process.env.TEMP || process.env.TMP || os.tmpdir()).toLowerCase();

  // Protected/unsuitable paths → fallback to home directory
  if (
    (tempDir && lower.startsWith(tempDir)) ||
    lower.includes('\\appdata\\local\\temp\\') ||
    lower.includes('\\program files\\') ||
    lower.includes('\\program files (x86)\\') ||
    lower.includes('\\windows\\') ||
    lower.includes('\\system32\\')
  ) {
    return os.homedir();
  }
  return cwd;
}

// =============================================================================
// Core Agent Execution (Electron-free)
// =============================================================================

export async function runAgentCore(
  userMessage: string,
  existingMessages: Message[] = [],
  config: AgentConfig = {},
  callbacks: AgentCallbacks = {},
  io: AgentIO,
  agentState: AgentRunState,
): Promise<AgentResult> {
  const {
    workingDirectory = getSafeDefaultCwd(),
    enablePlanning = true,
    resumeTodos = false,
    autoMode = true,
  } = config;

  logger.info('Starting agent', {
    userMessage: userMessage.substring(0, 100),
    existingMessagesCount: existingMessages.length,
    workingDirectory,
    enablePlanning,
    resumeTodos,
    autoMode,
  });

  // Initialize state - increment runId to invalidate any stale agent loops
  agentState.runId++;
  const currentRunId = agentState.runId;
  agentState.isRunning = true;
  agentState.abortController = new AbortController();
  // Reset LLM interrupt flag from previous pause/abort — without this,
  // the first LLM call after pause immediately throws INTERRUPTED
  llmClient.resetInterrupt();

  // Clear old todos if not resuming
  if (!resumeTodos) {
    agentState.currentTodos = [];
    agentState.pausedMessages = undefined;
  } else if (agentState.pausedMessages?.length) {
    // Restore paused run context so LLM knows what was done before pause
    existingMessages = [...existingMessages, ...agentState.pausedMessages];
    logger.info('Restored paused messages for resume', { count: agentState.pausedMessages.length });
    agentState.pausedMessages = undefined;
  }

  // Set working directory for all tool executors
  setWorkingDirectory(workingDirectory);
  setPowerShellWorkingDirectory(workingDirectory);

  // LLM 카운트다운 콜백 설정 (확장 retry 2분 대기 표시)
  llmClient.countdownCallback = (remainingSeconds: number) => {
    io.broadcast('agent:countdown', { seconds: remainingSeconds });
  };

  // Error telemetry context (moved before planning to avoid temporal dead zone)
  const currentModelInfo = configManager.getCurrentModel();
  const errorContext = {
    modelId: currentModelInfo?.id || 'unknown',
    modelName: currentModelInfo?.name || 'unknown',
  };

  // Setup callbacks
  setTodoWriteCallback(async (todos: TodoItem[]) => {
    // Cap TODOs at 3 to prevent executor from creating excessive TODOs
    const MAX_WRITE_TODOS = 3;
    if (todos.length > MAX_WRITE_TODOS) {
      todos = todos.slice(0, MAX_WRITE_TODOS);
    }

    const oldStatusMap = new Map(agentState.currentTodos.map(t => [t.id, t.status]));

    agentState.currentTodos = todos;
    if (callbacks.onTodoUpdate) {
      callbacks.onTodoUpdate(todos);
    }
    io.broadcast('agent:todoUpdate', todos);

    // Task 윈도우 자동 표시 (TODO가 처음 생성될 때)
    if (!io.isTaskWindowVisible() && todos.length > 0) {
      io.showTaskWindow();
    }

    // Background auto-sync: 모든 TODO 완료 시 1회만 실행
    const allComplete = todos.length > 0 && todos.every(t => t.status === 'completed');
    if (allComplete) {
      const completedTitles = todos.map(t => t.title).join(', ');
      handleTodoCompleteAutoSync({
        todoTitle: completedTitles,
        todoId: todos[todos.length - 1].id,
        allTodos: todos,
        historyContext: buildCompactHistory(existingMessages),
        userMessage,
        llmClient,
        notifyCallback: (result) => {
          io.broadcast('agent:autoSyncResult', result);
        },
      }).catch(() => {});
    }

    return true;
  });

  setGetTodosCallback(() => agentState.currentTodos);
  setFinalResponseCallback((message: string) => {
    logger.flow('Final response callback received', { messageLength: message.length });
  });

  setTellToUserCallback((message: string) => {
    if (callbacks.onTellUser) {
      callbacks.onTellUser(message);
    }
    io.broadcast('agent:tellUser', message);
  });

  setAskUserCallback(async (request: AskUserRequest) => {
    if (callbacks.onAskUser) {
      return callbacks.onAskUser(request);
    }
    return {
      selectedOption: request.options[0],
      isOther: false,
    };
  });

  // Supervised Mode: Tool approval callback
  if (!autoMode) {
    setToolApprovalCallback(async (toolName: string, args: Record<string, unknown>, reason?: string): Promise<ToolApprovalResult> => {
      return io.requestApproval(toolName, args, reason);
    });
  } else {
    setToolApprovalCallback(null);
  }

  // Tool execution callback
  setToolExecutionCallback((toolName: string, reason: string, args: Record<string, unknown>) => {
    if (callbacks.onToolExecution) {
      callbacks.onToolExecution(toolName, reason, args);
    }
    io.broadcast('agent:toolCall', { toolName, args: { ...args, reason } });
  });

  // Tool response callback
  setToolResponseCallback((toolName: string, success: boolean, result: string) => {
    if (callbacks.onToolResponse) {
      callbacks.onToolResponse(toolName, success, result);
    }
    io.broadcast('agent:toolResult', { toolName, success, result });
  });

  // Reasoning callback
  setReasoningCallback((content: string, isStreaming: boolean) => {
    io.broadcast('agent:reasoning', { content, isStreaming });
  });

  // Sub-agent phase callback — surface internal phases (enhancement, planning, execution, etc.) to renderer
  setSubAgentPhaseLogger((appName: string, phase: string, detail: string) => {
    io.broadcast('agent:subAgentPhase', { appName, phase, detail });
  });

  // Get tools from registry
  const tools = toolRegistry.getLLMToolDefinitions();
  const actualEnabledToolGroups = toolRegistry.getEnabledToolGroupIds() as string[];

  logger.info('Enabled tool groups from registry', { enabledToolGroups: actualEnabledToolGroups });

  // Build system prompt
  const systemPrompt = buildSystemPrompt(workingDirectory);

  // Initialize context tracker
  void getContextTracker();

  // ==========================================================================
  // Planning Phase
  // ==========================================================================
  if (enablePlanning && !resumeTodos && agentState.currentTodos.length === 0) {
    logger.flow('Starting planning phase');

    if (currentRunId !== agentState.runId || agentState.abortController?.signal.aborted) {
      throw new Error('Agent aborted');
    }

    try {
      const planningLLM = new PlanningLLM(
        llmClient as any,
        () => toolRegistry.getToolSummaryForPlanning(),
        () => toolRegistry.getEnabledOptionalToolsInfo()
      );

      planningLLM.setAskUserCallback(async (request: AskUserRequest) => {
        if (callbacks.onAskUser) {
          return callbacks.onAskUser(request);
        }
        return {
          selectedOption: request.options[0],
          isOther: false,
        };
      });

      const planningResult = await planningLLM.generateTODOList(
        userMessage,
        existingMessages
      );

      if (currentRunId !== agentState.runId) {
        throw new Error('Agent aborted');
      }

      // Add clarification messages to history
      if (planningResult.clarificationMessages?.length) {
        existingMessages = [...existingMessages, ...planningResult.clarificationMessages];
        logger.flow('Added planning clarification messages to history', {
          count: planningResult.clarificationMessages.length,
        });
      }

      if (planningResult.directResponse) {
        logger.flow('Planning returned direct response, skipping execution');

        logger.info('[CHAT] User message', { content: userMessage.substring(0, 500) });
        logger.info('[CHAT] Assistant response (direct)', { content: planningResult.directResponse.substring(0, 500) });

        if (callbacks.onComplete) {
          callbacks.onComplete(planningResult.directResponse);
        }
        io.broadcast('agent:complete', {
          response: planningResult.directResponse,
        });
        io.flashWindows();

        agentState.isRunning = false;
        agentState.abortController = null;

        const lastMsg = existingMessages[existingMessages.length - 1];
        const needsUserMessage = !(lastMsg?.role === 'user' && lastMsg?.content === userMessage);
        const updatedMessages = needsUserMessage
          ? [...existingMessages, { role: 'user' as const, content: userMessage }, { role: 'assistant' as const, content: planningResult.directResponse }]
          : [...existingMessages, { role: 'assistant' as const, content: planningResult.directResponse }];

        return {
          success: true,
          response: planningResult.directResponse,
          messages: updatedMessages,
          toolCalls: [],
          iterations: 0,
        };
      }

      if (planningResult.todos.length > 0) {
        agentState.currentTodos = planningResult.todos;

        if (callbacks.onTodoUpdate) {
          callbacks.onTodoUpdate(planningResult.todos);
        }
        io.broadcast('agent:todoUpdate', planningResult.todos);

        // Broadcast session title for tab name update
        if (planningResult.title) {
          io.broadcast('agent:sessionTitle', planningResult.title);
        }

        logger.info('Planning complete', {
          todoCount: planningResult.todos.length,
          complexity: planningResult.complexity,
          title: planningResult.title,
        });
      }
    } catch (planningError) {
      logger.errorSilent('Planning failed, falling back to direct execution', planningError as Error);
      reportError(planningError, { type: 'planning', method: 'generateTODOList', ...errorContext }).catch(() => {});
    }
  }

  // ==========================================================================
  // Prepare Messages
  // ==========================================================================
  let validMessages: Message[] = validateToolMessages([...existingMessages]);
  validMessages = truncateMessages(validMessages, 100);
  validMessages = validMessages.filter((m) => m.role !== 'system');

  let baseHistory: Message[] = [...validMessages];
  const toolLoopMessages: Message[] = [];

  const hasVision = toolRegistry.isToolGroupEnabled('vision');
  const criticalReminders = getCriticalReminders(hasVision, workingDirectory, getWindowsDesktopPath());
  const rebuildMessages = (loopMessages: Message[]): Message[] => {
    const allMessages = [...baseHistory, { role: 'user' as const, content: userMessage }, ...loopMessages];

    const historyMessages = allMessages.slice(0, -1);
    const lastMsg = allMessages[allMessages.length - 1];
    const lastContent = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
    const lastTag = lastMsg.role === 'tool' ? '[TOOL_RESULT]' : lastMsg.role === 'user' ? '[USER]' : `[${lastMsg.role.toUpperCase()}]`;

    const historyText = flattenMessagesToHistory(historyMessages);
    const todoContext = buildTodoContext(agentState.currentTodos);

    let userContent = '';
    if (todoContext) {
      userContent += `<CURRENT_TASK>\n${todoContext}\n</CURRENT_TASK>\n\n`;
    }
    if (historyText) {
      userContent += `<CONVERSATION_HISTORY>\n${historyText}\n</CONVERSATION_HISTORY>\n\n`;
    }
    userContent += `<CURRENT_REQUEST>\n${lastTag}: ${lastContent}\n</CURRENT_REQUEST>\n\n${criticalReminders}`;

    return [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ];
  };

  let messages: Message[] = rebuildMessages([]);

  const addMessage = (msg: Message) => {
    messages.push(msg);
    toolLoopMessages.push(msg);
  };

  logger.info('[CHAT] User message', { content: userMessage.substring(0, 500) });

  const userMessageObj = { role: 'user' as const, content: userMessage };
  if (callbacks.onMessage) {
    callbacks.onMessage(userMessageObj);
  }
  io.broadcast('agent:message', userMessageObj);

  const toolCallHistory: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
  }> = [];

  let iterations = 0;
  let finalResponse = '';
  let noToolCallRetries = 0;
  const MAX_NO_TOOL_CALL_RETRIES = 5;
  let contextCompactRetried = false;
  let finalResponseFailures = 0;
  const MAX_FINAL_RESPONSE_FAILURES = 3;
  let consecutiveParseFailures = 0;
  const MAX_CONSECUTIVE_PARSE_FAILURES = 3;
  let consecutiveTellToUserCalls = 0;
  const MAX_CONSECUTIVE_TELL_TO_USER = 2;

  const parseFailureToolCallIds = new Set<string>();
  const stripParseFailures = (msgs: Message[]): Message[] => {
    if (parseFailureToolCallIds.size === 0) return msgs;
    return msgs.filter(msg => {
      if (msg.role === 'tool' && msg.tool_call_id && parseFailureToolCallIds.has(msg.tool_call_id)) return false;
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 &&
          msg.tool_calls.every(tc => parseFailureToolCallIds.has(tc.id))) return false;
      return true;
    });
  };

  const SOFT_ITERATION_LIMIT = 50;
  let softLimitWarned = false;

  try {
    while (agentState.isRunning) {
      iterations++;

      messages = rebuildMessages(toolLoopMessages);

      logger.info(`Agent iteration ${iterations}`, { messagesCount: messages.length });

      // [DEBUG] Log last 4 messages before LLM call
      {
        const lastN = messages.slice(-4);
        const debugMsgs = lastN.map((m, i) => {
          const idx = messages.length - lastN.length + i;
          const base: Record<string, unknown> = { idx, role: m.role };
          if (m.role === 'tool') {
            base.tool_call_id = (m as any).tool_call_id;
            base.content = typeof m.content === 'string' ? m.content.substring(0, 300) : m.content;
          } else if (m.role === 'assistant') {
            base.contentSnippet = typeof m.content === 'string' ? m.content.substring(0, 100) : '(none)';
            base.toolCalls = (m as any).tool_calls?.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              argsSnippet: typeof tc.function?.arguments === 'string' ? tc.function.arguments.substring(0, 100) : '',
            }));
          } else {
            base.contentSnippet = typeof m.content === 'string' ? m.content.substring(0, 100) : '(none)';
          }
          return base;
        });
        logger.info('[DEBUG] Messages before LLM call (last 4)', { messages: JSON.stringify(debugMsgs) });
      }

      // Soft warning at 50 iterations
      if (iterations === SOFT_ITERATION_LIMIT && !softLimitWarned) {
        softLimitWarned = true;
        logger.warn(`Reached ${SOFT_ITERATION_LIMIT} iterations (informational)`);
        addMessage({
          role: 'user',
          content: `You have made ${SOFT_ITERATION_LIMIT} tool calls. Please wrap up and call final_response soon to deliver your results.`,
        });
      }

      if (currentRunId !== agentState.runId || agentState.abortController?.signal.aborted) {
        throw new Error('Agent aborted');
      }

      // Call LLM with context length error recovery
      let response;
      try {
        response = await llmClient.chatCompletion({
          messages,
          tools,
          tool_choice: 'required',
          temperature: 0.7,
        });
      } catch (llmError) {
        if (llmError instanceof ContextLengthError && !contextCompactRetried) {
          contextCompactRetried = true;
          logger.warn('Context length exceeded - rolling back last tool group');

          if (callbacks.onTellUser) {
            callbacks.onTellUser('컨텍스트 길이 초과 - 마지막 도구 실행을 롤백하고 재시도합니다...');
          }
          io.broadcast('agent:tellUser', '컨텍스트 길이 초과 - 마지막 도구 실행을 롤백하고 재시도합니다...');

          let rollbackIdx = toolLoopMessages.length - 1;
          while (rollbackIdx >= 0 && toolLoopMessages[rollbackIdx]?.role === 'tool') {
            rollbackIdx--;
          }
          if (rollbackIdx >= 0 && toolLoopMessages[rollbackIdx]?.tool_calls) {
            toolLoopMessages.length = rollbackIdx;
            logger.debug('Rolled back toolLoopMessages', { newLength: toolLoopMessages.length });
          }

          continue;
        } else if (llmError instanceof QuotaExceededError) {
          // Quota exceeded — stop agent gracefully with user-facing message
          const quotaMsg = llmError.quota
            ? `사용 한도를 초과했습니다. 시간당: ${llmError.quota.hourly?.timeDisplay || '알 수 없음'} 남음, 주간: ${llmError.quota.weekly?.timeDisplay || '알 수 없음'} 남음`
            : '서버 사용 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';

          logger.warn('Quota exceeded during agent execution', { quota: llmError.quota });
          if (callbacks.onTellUser) {
            callbacks.onTellUser(quotaMsg);
          }
          io.broadcast('agent:tellUser', quotaMsg);

          // Return gracefully instead of crashing
          const errorReturnMessages = stripParseFailures(toolLoopMessages);
          return {
            success: false,
            response: quotaMsg,
            messages: [...validMessages, { role: 'user' as const, content: userMessage }, ...errorReturnMessages],
            toolCalls: toolCallHistory,
            iterations,
            error: quotaMsg,
          };
        } else if (llmError instanceof APIError && llmError.statusCode === 400 && iterations > 1 && toolLoopMessages.length > 0) {
          // HTTP 400 after successful tool execution — likely CONVERSATION_HISTORY grew too large.
          // Condition: iterations > 1 ensures at least one successful LLM call occurred,
          // so the request format itself is valid. A 400 on iteration 1 is a genuine format
          // error and should propagate normally.
          // Some LLM proxies (e.g. Samsung A2G) return 400 instead of standard context_length error.
          const errorMsg = `LLM API 요청 오류 (HTTP 400). 도구 실행 결과가 너무 크거나 메시지 형식이 호환되지 않을 수 있습니다.`;
          logger.warn('HTTP 400 after tool execution - returning gracefully', {
            toolLoopLength: toolLoopMessages.length,
            iterations,
            error: (llmError as Error).message,
          });
          if (callbacks.onTellUser) {
            callbacks.onTellUser(errorMsg);
          }
          io.broadcast('agent:tellUser', errorMsg);

          // Return only validMessages + userMessage (exclude failed toolLoopMessages)
          return {
            success: false,
            response: errorMsg,
            messages: [...validMessages, { role: 'user' as const, content: userMessage }],
            toolCalls: toolCallHistory,
            iterations,
            error: (llmError as Error).message,
          };
        } else {
          throw llmError;
        }
      }

      if (currentRunId !== agentState.runId || !agentState.isRunning || agentState.abortController?.signal.aborted) {
        logger.info('Agent aborted after LLM response');
        throw new Error('Agent aborted');
      }

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error('No response from LLM');
      }

      addMessage(assistantMessage);

      logger.info('[CHAT] Assistant message', {
        content: assistantMessage.content?.substring(0, 500),
        hasToolCalls: !!assistantMessage.tool_calls?.length,
        toolCount: assistantMessage.tool_calls?.length || 0,
        toolCallDetails: assistantMessage.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          argsSnippet: tc.function.arguments?.substring(0, 150),
        })),
      });

      if (callbacks.onMessage) {
        callbacks.onMessage(assistantMessage);
      }
      io.broadcast('agent:message', assistantMessage);

      // Check for tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Enforce single tool per turn
        if (assistantMessage.tool_calls.length > 1) {
          logger.warn(`[SINGLE-TOOL ENFORCED] LLM returned ${assistantMessage.tool_calls.length} tool_calls, truncating to first only: ${assistantMessage.tool_calls.map(tc => tc.function.name).join(', ')}`);
          assistantMessage.tool_calls = [assistantMessage.tool_calls[0]];
        }

        for (const toolCall of assistantMessage.tool_calls) {
          if (currentRunId !== agentState.runId || agentState.abortController?.signal.aborted) {
            throw new Error('Agent aborted');
          }

          // Sanitize tool name
          const rawToolName = toolCall.function.name;
          const toolName =
            rawToolName.replace(/<\|.*$/, '').replace(/[^a-zA-Z0-9_-]+$/, '').trim() || rawToolName;
          if (toolName !== rawToolName) {
            logger.warn('Tool name sanitized (model leaked special tokens)', {
              original: rawToolName,
              sanitized: toolName,
            });
            toolCall.function.name = toolName;
          }
          let toolArgs: Record<string, unknown>;

          try {
            toolArgs = parseToolArguments(toolCall.function.arguments);
          } catch (parseError) {
            consecutiveParseFailures++;
            parseFailureToolCallIds.add(toolCall.id);
            const errorMessage = `Error parsing tool arguments: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`;
            logger.errorSilent('Tool argument parse error', {
              toolName,
              error: errorMessage,
              consecutiveFailures: consecutiveParseFailures,
            });

            reportError(parseError, {
              type: 'toolArgParsing',
              tool: toolName,
              consecutiveFailures: consecutiveParseFailures,
              ...errorContext,
              rawArguments: typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments.substring(0, 500) : undefined,
            }).catch(() => {});

            // 3회 연속 parse 실패 시 abort
            if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
              logger.errorSilent('[ABORT] Tool argument parse failed 3 times consecutively. Model may not support JSON function calling.');
              const abortMsg = '현재 모델이 올바른 JSON tool arguments를 생성하지 못하고 있습니다. 다른 모델로 변경해 주세요.';
              addMessage({
                role: 'tool',
                content: errorMessage,
                tool_call_id: toolCall.id,
              });

              io.broadcast('agent:message', {
                role: 'assistant',
                content: abortMsg,
              });
              toolLoopMessages.push({ role: 'assistant' as const, content: abortMsg });
              const abortReturnMessages = stripParseFailures(toolLoopMessages);
              return {
                success: false,
                response: abortMsg,
                messages: [...validMessages, { role: 'user' as const, content: userMessage }, ...abortReturnMessages],
                toolCalls: toolCallHistory,
                iterations,
              };
            }

            // LLM에게 구체적 피드백
            const rawArgs = toolCall.function.arguments;
            const rawPreview = typeof rawArgs === 'string' ? rawArgs.substring(0, 300) : String(rawArgs);
            const hintMsg = `Error: Failed to parse tool arguments for "${toolName}".

Parse error: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}

Your raw input was:
\`\`\`
${rawPreview}
\`\`\`

Fix the following issues:
1. Arguments MUST be valid JSON (not XML, not plain text)
2. All strings must use double quotes ("), not single quotes (')
3. No trailing commas after the last property
4. No comments inside JSON
5. Escape special characters in strings (\\n, \\", \\\\)

Correct format example:
\`\`\`json
{"reason": "description", "file_path": "src/index.ts"}
\`\`\`

Do NOT use XML tags like <arg_key> or <arg_value>. Retry with valid JSON.`;
            addMessage({
              role: 'tool',
              content: hintMsg,
              tool_call_id: toolCall.id,
            });

            toolCallHistory.push({
              tool: toolName,
              args: {},
              result: errorMessage,
              success: false,
            });

            continue;
          }

          // Schema validation
          const toolDef = tools.find(t => t.function.name === toolName);
          const schema = toolDef?.function.parameters as { properties: Record<string, unknown>; required?: string[] } | undefined;
          if (schema?.properties) {
            const schemaErrors: string[] = [];

            if (schema.required) {
              for (const req of schema.required) {
                if (toolArgs[req] === undefined || toolArgs[req] === null) {
                  const propDef = schema.properties[req] as { type?: string } | undefined;
                  schemaErrors.push(`Missing required parameter: "${req}" (expected: ${propDef?.type || 'unknown'})`);
                }
              }
            }

            for (const [key, value] of Object.entries(toolArgs)) {
              const propDef = schema.properties[key] as { type?: string } | undefined;
              if (propDef?.type && value !== null && value !== undefined) {
                const actualType = Array.isArray(value) ? 'array' : typeof value;
                if (actualType !== propDef.type) {
                  schemaErrors.push(`"${key}": expected ${propDef.type}, got ${actualType} (${JSON.stringify(value).substring(0, 50)})`);
                }
              }
            }

            if (schemaErrors.length > 0) {
              consecutiveParseFailures++;
              parseFailureToolCallIds.add(toolCall.id);

              if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
                const abortMsg = '현재 모델이 올바른 tool arguments를 생성하지 못하고 있습니다. 다른 모델로 변경해 주세요.';
                addMessage({ role: 'tool', content: schemaErrors.join('\n'), tool_call_id: toolCall.id });
                io.broadcast('agent:message', { role: 'assistant', content: abortMsg });
                toolLoopMessages.push({ role: 'assistant' as const, content: abortMsg });
                const abortReturnMessages = stripParseFailures(toolLoopMessages);
                return {
                  success: false,
                  response: abortMsg,
                  messages: [...validMessages, { role: 'user' as const, content: userMessage }, ...abortReturnMessages],
                  toolCalls: toolCallHistory,
                  iterations,
                };
              }

              const requiredList = (schema.required || [])
                .map(r => {
                  const p = schema.properties[r] as { type?: string } | undefined;
                  return `  "${r}": ${p?.type || 'unknown'}`;
                })
                .join('\n');
              const hintMsg = `Error: Schema validation failed for "${toolName}".

${schemaErrors.join('\n')}

Required parameters:
${requiredList}

Retry with correct parameter names and types.`;
              addMessage({ role: 'tool', content: hintMsg, tool_call_id: toolCall.id });
              toolCallHistory.push({ tool: toolName, args: toolArgs, result: 'Error: Schema validation failed', success: false });
              continue;
            }
          }

          // Parse + schema validation passed → reset counter
          consecutiveParseFailures = 0;

          // tell_to_user 연속 호출 감지 — 무한루프 방지
          if (toolName === 'tell_to_user') {
            consecutiveTellToUserCalls++;
            logger.info('[CHAT] tell_to_user called', {
              consecutive: consecutiveTellToUserCalls,
              message: (toolArgs['message'] as string || '').substring(0, 300),
            });

            if (consecutiveTellToUserCalls > MAX_CONSECUTIVE_TELL_TO_USER) {
              logger.errorSilent(`[LOOP DETECTED] tell_to_user called ${consecutiveTellToUserCalls} times consecutively — forcing final_response`, {
                lastMessage: (toolArgs['message'] as string || '').substring(0, 200),
              });
              reportError(new Error(`tell_to_user infinite loop detected (${consecutiveTellToUserCalls} consecutive calls)`), {
                type: 'tellToUserLoop',
                consecutiveCalls: consecutiveTellToUserCalls,
                lastMessage: (toolArgs['message'] as string || '').substring(0, 500),
                ...errorContext,
                iterations,
              }).catch(() => {});

              addMessage({
                role: 'tool',
                content: `Error: tell_to_user has been called ${consecutiveTellToUserCalls} times consecutively. This indicates an infinite loop. You MUST call final_response now to complete the task. Do NOT call tell_to_user again.`,
                tool_call_id: toolCall.id,
              });
              toolCallHistory.push({ tool: toolName, args: toolArgs, result: 'Error: consecutive tell_to_user loop detected', success: false });
              continue;
            }
          } else {
            consecutiveTellToUserCalls = 0;
          }

          logger.info(`Executing tool: ${toolName}`, { args: JSON.stringify(toolArgs).substring(0, 200) });

          // Supervised Mode: Request approval before executing tool
          const skipApproval = autoMode || NO_APPROVAL_TOOLS.has(toolName) || agentState.alwaysApprovedTools.has(toolName);

          if (!skipApproval) {
            // For edit_file, show diff preview BEFORE asking for approval
            if (toolName === 'edit_file') {
              try {
                const filePath = toolArgs['file_path'] as string;
                const resolvedPath = path.isAbsolute(filePath)
                  ? filePath
                  : path.resolve(workingDirectory, filePath);
                const ext = path.extname(filePath).toLowerCase();
                const langMap: Record<string, string> = {
                  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
                  '.py': 'python', '.json': 'json', '.html': 'html', '.css': 'css', '.md': 'markdown',
                };
                const language = langMap[ext] || 'plaintext';

                const rawOld = toolArgs['old_string'] as string || '';
                const rawNew = toolArgs['new_string'] as string || '';
                const oldString = rawOld.includes('\n') ? rawOld : rawOld.replace(/\\\\n/g, '\x00E\x00').replace(/\\n/g, '\n').replace(/\x00E\x00/g, '\\n');
                const newString = rawNew.includes('\n') ? rawNew : rawNew.replace(/\\\\n/g, '\x00E\x00').replace(/\\n/g, '\n').replace(/\x00E\x00/g, '\\n');
                const originalContent = await fs.readFile(resolvedPath, 'utf-8');
                const newContent = originalContent.replace(oldString, newString);

                io.sendFileEdit({
                  path: resolvedPath,
                  originalContent,
                  newContent,
                  language,
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
              } catch (previewError) {
                logger.warn('[Supervised] Failed to show edit_file preview', { error: previewError });
              }
            }

            // Request approval
            const approvalResult = await requestToolApproval(
              toolName,
              toolArgs,
              toolArgs['reason'] as string | undefined
            );

            if (approvalResult === 'always') {
              agentState.alwaysApprovedTools.add(toolName);
              logger.info('[Supervised] Tool always-approved for session', { toolName });
            }

            if (approvalResult && typeof approvalResult === 'object' && approvalResult.reject) {
              const rejectMessage = `Tool execution rejected by user: ${approvalResult.comment || 'No reason provided'}`;
              logger.info('[Supervised] Tool rejected', { toolName, comment: approvalResult.comment });

              addMessage({
                role: 'tool',
                content: rejectMessage,
                tool_call_id: toolCall.id,
              });

              toolCallHistory.push({
                tool: toolName,
                args: toolArgs,
                result: rejectMessage,
                success: false,
              });

              continue;
            }
          }

          // Handle ask_to_user specially — bypass global callback, use worker IPC directly
          if (toolName === 'ask_to_user' && callbacks.onAskUser) {
            const question = toolArgs['question'] as string;
            const options = toolArgs['options'] as string[];

            if (!question || !Array.isArray(options) || options.length < 2) {
              const errorResult = `Invalid ask_to_user parameters`;
              addMessage({ role: 'tool', content: errorResult, tool_call_id: toolCall.id });
              toolCallHistory.push({ tool: toolName, args: toolArgs, result: errorResult, success: false });
              continue;
            }

            // Notify UI about tool execution (tool card)
            if (callbacks.onToolExecution) {
              callbacks.onToolExecution(toolName, toolArgs['reason'] as string || 'Asking user', toolArgs);
            }
            io.broadcast('agent:toolCall', { toolName, args: { ...toolArgs, reason: toolArgs['reason'] || 'Asking user' } });

            // Call onAskUser directly via worker IPC → main → renderer modal
            const askResponse = await callbacks.onAskUser({ question, options });
            const resultText = askResponse.isOther && askResponse.customText
              ? `User provided custom response: "${askResponse.customText}"`
              : `User selected: "${askResponse.selectedOption}"`;

            // Notify UI about tool result
            if (callbacks.onToolResult) {
              callbacks.onToolResult(toolName, resultText, true);
            }
            io.broadcast('agent:toolResult', { toolName, result: resultText, success: true });

            addMessage({ role: 'tool', content: resultText, tool_call_id: toolCall.id });
            toolCallHistory.push({ tool: toolName, args: toolArgs, result: resultText, success: true });
            continue;
          }

          // Execute tool (route to agent tool or simple tool)
          const registeredTool = toolRegistry.get(toolName);
          const result = (registeredTool && isLLMAgentTool(registeredTool))
            ? await executeAgentTool(toolName, toolArgs, llmClient)
            : await executeSimpleTool(toolName, toolArgs);

          if (currentRunId !== agentState.runId || !agentState.isRunning || agentState.abortController?.signal.aborted) {
            logger.info('Agent aborted after tool execution', { toolName });
            throw new Error('Agent aborted');
          }

          const toolResultContent = result.success
            ? result.result || '(no output)'
            : `Error: ${result.error}`;

          if (!result.success) {
            reportError(new Error(result.error || 'Tool execution failed'), {
              type: 'toolExecution',
              tool: toolName,
              ...errorContext,
              toolArgs,
            }).catch(() => {});
          }

          logger.info(`Tool result: ${toolName}`, {
            success: result.success,
            resultLength: toolResultContent.length,
          });

          // Handle final_response tool specially
          if (toolName === 'final_response') {
            if (result.success && result.metadata?.['isFinalResponse']) {
              logger.flow('final_response tool executed successfully - returning');
              finalResponse = result.result || '';

              addMessage({
                role: 'tool',
                content: toolResultContent,
                tool_call_id: toolCall.id,
              });

              toolCallHistory.push({
                tool: toolName,
                args: toolArgs,
                result: toolResultContent,
                success: result.success,
              });

              io.broadcast('agent:toolResult', {
                toolName,
                result: finalResponse,
                success: result.success,
              });

              logger.info('[CHAT] Final response', { content: finalResponse.substring(0, 500) });

              if (callbacks.onComplete) {
                callbacks.onComplete(finalResponse);
              }
              io.broadcast('agent:complete', { response: '' });
              io.flashWindows();

              const finalReturnToolLoopMessages = stripParseFailures(toolLoopMessages);
              const finalReturnMessages = [...validMessages, { role: 'user' as const, content: userMessage }, ...finalReturnToolLoopMessages];

              return {
                success: true,
                response: finalResponse,
                messages: finalReturnMessages,
                toolCalls: toolCallHistory,
                iterations,
              };
            } else {
              finalResponseFailures++;
              logger.flow(`final_response failed (attempt ${finalResponseFailures}/${MAX_FINAL_RESPONSE_FAILURES}): ${result.error}`);

              if (finalResponseFailures >= MAX_FINAL_RESPONSE_FAILURES) {
                logger.warn('Max final_response failures exceeded - forcing completion');
                const fallbackMessage = (toolArgs['message'] as string) || 'Task completed with incomplete TODOs.';

                addMessage({
                  role: 'tool',
                  content: fallbackMessage,
                  tool_call_id: toolCall.id,
                });

                toolCallHistory.push({
                  tool: toolName,
                  args: toolArgs,
                  result: fallbackMessage,
                  success: false,
                });

                if (callbacks.onToolResult) {
                  callbacks.onToolResult(toolName, fallbackMessage, false);
                }
                io.broadcast('agent:toolResult', {
                  toolName,
                  result: fallbackMessage,
                  success: false,
                });

                if (callbacks.onTellUser) {
                  callbacks.onTellUser('완료되지 않은 TODO가 있지만, 최대 재시도 횟수에 도달하여 작업을 종료합니다.');
                }
                io.broadcast('agent:tellUser', '완료되지 않은 TODO가 있지만, 최대 재시도 횟수에 도달하여 작업을 종료합니다.');

                logger.info('[CHAT] Final response (fallback)', { content: fallbackMessage.substring(0, 500) });

                if (callbacks.onComplete) {
                  callbacks.onComplete(fallbackMessage);
                }
                io.broadcast('agent:complete', { response: fallbackMessage });
                io.flashWindows();

                const fbReturnToolLoopMessages = stripParseFailures(toolLoopMessages);
                const fbReturnMessages = [...validMessages, { role: 'user' as const, content: userMessage }, ...fbReturnToolLoopMessages];

                return {
                  success: true,
                  response: fallbackMessage,
                  messages: fbReturnMessages,
                  toolCalls: toolCallHistory,
                  iterations,
                };
              }
            }
          }

          addMessage({
            role: 'tool',
            content: toolResultContent,
            tool_call_id: toolCall.id,
          });

          logger.info('[DEBUG] Tool result pushed', {
            toolName,
            tool_call_id: toolCall.id,
            contentSnippet: toolResultContent.substring(0, 200),
            messagesCountAfterPush: messages.length,
            lastMsgRole: messages[messages.length - 1]?.role,
            lastMsgToolCallId: (messages[messages.length - 1] as any)?.tool_call_id,
          });

          toolCallHistory.push({
            tool: toolName,
            args: toolArgs,
            result: toolResultContent,
            success: result.success,
          });

          if (callbacks.onToolResult) {
            callbacks.onToolResult(toolName, toolResultContent, result.success);
          }
          io.broadcast('agent:toolResult', {
            toolName,
            result: toolResultContent,
            success: result.success,
          });
        }
      } else {
        noToolCallRetries++;
        logger.flow(`No tool call - enforcing tool usage (attempt ${noToolCallRetries}/${MAX_NO_TOOL_CALL_RETRIES})`);

        // Remove empty assistant message from history to prevent context pollution
        // Empty messages (no content, no tool_calls) waste tokens and confuse the LLM on retry
        if (!assistantMessage.content && (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0)) {
          messages.pop();
          toolLoopMessages.pop();
          logger.debug('Removed empty assistant message from history');
        }

        if (noToolCallRetries > MAX_NO_TOOL_CALL_RETRIES) {
          logger.warn('Max no-tool-call retries exceeded - returning content as final response');
          finalResponse = assistantMessage.content || 'Task completed.';
          break;
        }

        const hasMalformedToolCall = assistantMessage.content &&
          (/<tool_call>/i.test(assistantMessage.content) ||
           /<arg_key>/i.test(assistantMessage.content) ||
           /<arg_value>/i.test(assistantMessage.content) ||
           /<\/tool_call>/i.test(assistantMessage.content) ||
           /bash<arg_key>/i.test(assistantMessage.content) ||
           /<xai:function_call/i.test(assistantMessage.content) ||
           /<\/xai:function_call>/i.test(assistantMessage.content) ||
           /<parameter\s+name=/i.test(assistantMessage.content));

        const retryMessage = hasMalformedToolCall
          ? 'Your previous response contained a malformed tool call (XML tags in content). You MUST use the proper tool_calls API format. Use final_response tool to deliver your message to the user.'
          : 'You must use tools for all actions. Use final_response tool to deliver your final message to the user after completing all tasks.';

        if (hasMalformedToolCall) {
          logger.warn('Malformed tool call detected in content', {
            contentSnippet: assistantMessage.content?.substring(0, 200),
          });
        }

        addMessage({
          role: 'user',
          content: retryMessage,
        });

        continue;
      }

      // ========================================================================
      // Preventative auto-compact check
      // ========================================================================
      const model = configManager.getCurrentModel();
      const maxTokens = model?.maxTokens || 128000;

      const usage = contextTracker.getContextUsage(maxTokens);
      if (usage.usagePercentage > 0) {
        io.broadcast('agent:contextUpdate', {
          usagePercentage: usage.usagePercentage,
          currentTokens: usage.currentTokens,
          maxTokens: usage.maxTokens,
        });
      }

      if (contextTracker.shouldTriggerAutoCompact(maxTokens)) {
        logger.flow('Preventative auto-compact triggered at threshold', {
          usagePercentage: usage.usagePercentage,
        });

        if (callbacks.onTellUser) {
          callbacks.onTellUser(`컨텍스트 ${usage.usagePercentage}% 사용 - 자동 압축을 실행합니다...`);
        }
        io.broadcast('agent:tellUser', `컨텍스트 ${usage.usagePercentage}% 사용 - 자동 압축을 실행합니다...`);

        const fullMessages = [...baseHistory, ...toolLoopMessages];
        const compactResult = await compactConversation(fullMessages, { workingDirectory, todos: agentState.currentTodos });

        if (currentRunId !== agentState.runId) {
          throw new Error('Agent aborted');
        }

        if (compactResult.success && compactResult.compactedMessages) {
          logger.info('Preventative auto-compact successful', {
            originalCount: compactResult.originalMessageCount,
            newCount: compactResult.newMessageCount,
          });

          const lastTwoMessages = fullMessages.slice(-2);

          validMessages = [...compactResult.compactedMessages, ...lastTwoMessages];
          baseHistory = [...compactResult.compactedMessages, ...lastTwoMessages];
          toolLoopMessages.length = 0;

          const rebuildPreview = rebuildMessages(toolLoopMessages);
          const totalContent = rebuildPreview
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            .join('');
          const estimatedTokens = contextTracker.estimateTokens(totalContent);
          contextTracker.reset(estimatedTokens);

          const newUsage = contextTracker.getContextUsage(maxTokens);
          io.broadcast('agent:contextUpdate', {
            usagePercentage: newUsage.usagePercentage,
            currentTokens: newUsage.currentTokens,
            maxTokens: newUsage.maxTokens,
          });
        } else {
          logger.warn('Preventative auto-compact failed', { error: compactResult.error });
        }
      }
    }

    if (callbacks.onComplete) {
      callbacks.onComplete(finalResponse);
    }
    io.broadcast('agent:complete', { response: finalResponse });
    io.flashWindows();

    const returnToolLoopMessages = stripParseFailures(toolLoopMessages);
    const returnMessages = [...validMessages, { role: 'user' as const, content: userMessage }, ...returnToolLoopMessages];

    return {
      success: true,
      response: finalResponse,
      messages: returnMessages,
      toolCalls: toolCallHistory,
      iterations,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const isAbort = errorMessage === 'Agent aborted' || errorMessage === 'INTERRUPTED';
    if (isAbort) {
      logger.info('Agent terminated by user abort', { iterations });
      // Broadcast completion so ChatApp can reset tab.isRunning
      io.broadcast('agent:complete', { response: '' });
    } else {
      logger.errorSilent('Agent error', { error: errorMessage });
    }

    if (!isAbort) {
      // LLM 확장 retry 전부 실패 → retryableError broadcast (UI에서 retry 버튼 표시)
      if (error instanceof LLMRetryExhaustedError) {
        io.broadcast('agent:retryableError', { error: errorMessage });
      } else {
        try { updateRecentMessagesForTelemetry(messages); } catch { /* ignore */ }
        reportError(error, { type: 'agent', method: 'runAgent' }).catch(() => {});
        if (callbacks.onError) {
          callbacks.onError(error instanceof Error ? error : new Error(errorMessage));
        }
        io.broadcast('agent:error', { error: errorMessage });
      }
    }

    const errorReturnToolLoopMessages = stripParseFailures(toolLoopMessages);
    if (isAbort) {
      // Save partial messages for resume — so next run has context of work done before pause
      agentState.pausedMessages = [
        { role: 'user' as const, content: userMessage },
        ...errorReturnToolLoopMessages,
        { role: 'assistant' as const, content: '[PAUSED BY USER]' },
      ];
      logger.info('Saved paused messages for resume', { count: agentState.pausedMessages.length });
    }
    const returnMessages = [...validMessages, { role: 'user' as const, content: userMessage }, ...errorReturnToolLoopMessages];

    return {
      success: isAbort,
      response: '',
      messages: returnMessages,
      toolCalls: toolCallHistory,
      iterations,
      error: isAbort ? undefined : errorMessage,
    };
  } finally {
    if (currentRunId === agentState.runId) {
      agentState.isRunning = false;
      agentState.abortController = null;

      setTodoWriteCallback(null as never);
      setTellToUserCallback(null as never);
      setAskUserCallback(null as never);
      setReasoningCallback(null as never);
      clearFinalResponseCallbacks();
    }
  }
}
