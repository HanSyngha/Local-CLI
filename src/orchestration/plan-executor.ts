/**
 * Plan Executor
 *
 * Plan & Execute    
 * React     
 *
 *   Planning  (Direct Mode )
 */

import { Message, TodoItem } from '../types/index.js';
import { LLMClient } from '../core/llm/llm-client.js';
import { PlanningLLM } from '../agents/planner/index.js';
import { sessionManager } from '../core/session/session-manager.js';
import {
  CompactManager,
  CompactResult,
  contextTracker,
  buildCompactedMessages,
} from '../core/compact/index.js';
import { configManager } from '../core/config/config-manager.js';
import {
  setTodoWriteCallback,
  clearTodoCallbacks,
  TodoInput,
} from '../tools/llm/simple/todo-tools.js';
import {
  setGetTodosCallback,
  setFinalResponseCallback,
  clearFinalResponseCallbacks,
} from '../tools/llm/simple/final-response-tool.js';
import {
  emitPlanCreated,
  emitTodoStart,
  emitTodoComplete,
  emitTodoFail,
  emitCompact,
  emitAssistantResponse,
} from '../tools/llm/simple/file-tools.js';
import { toolRegistry } from '../tools/registry.js';
import { PLAN_EXECUTE_SYSTEM_PROMPT as PLAN_PROMPT, getCriticalReminders, VISION_VERIFICATION_RULE } from '../prompts/system/plan-execute.js';
import { GIT_COMMIT_RULES } from '../prompts/shared/git-rules.js';
import { logger } from '../utils/logger.js';
import { getStreamLogger } from '../utils/json-stream-logger.js';
import { detectGitRepo } from '../utils/git-utils.js';
import { getWindowsUserDesktopPath } from '../utils/platform-utils.js';

import type { StateCallbacks } from './types.js';
import { formatErrorMessage, buildTodoContext, flattenMessagesToHistory, findActiveTodo, getTodoStats } from './utils.js';
import { reportError, updateRecentMessagesForTelemetry } from '../core/telemetry/error-reporter.js';
import { LLMRetryExhaustedError } from '../errors/llm.js';

/**
 * Build system prompt with conditional Git rules
 * Git rules are only added when .git folder exists in working directory
 */
function buildSystemPrompt(): string {
  const isGitRepo = detectGitRepo();
  const hasVision = toolRegistry.isToolGroupEnabled('vision');
  const desktopPath = getWindowsUserDesktopPath();
  let prompt = PLAN_PROMPT;
  if (desktopPath) {
    prompt = prompt.replace(/\{WINDOWS_DESKTOP\}/g, desktopPath);
  }
  if (isGitRepo) {
    prompt += `\n\n${GIT_COMMIT_RULES}`;
  }
  if (hasVision) {
    prompt += `\n\n${VISION_VERIFICATION_RULE}`;
  }
  return prompt;
}

/**
 * Plan Executor
 *
 *   Planning  
 * chatCompletionWithTools  tool loop    
 */
export class PlanExecutor {


  constructor() {
    // No configuration needed - chatCompletionWithTools handles the loop internally
  }

  /**
   * Plan Mode  (TODO  )
   *  Planning Docs Search Decision 
   */
  async executePlanMode(
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    isInterruptedRef: { current: boolean },
    callbacks: StateCallbacks
  ): Promise<void> {
    const planningStartTime = Date.now();
    const streamLogger = getStreamLogger();

    logger.enter('PlanExecutor.executePlanMode', { messageLength: userMessage.length });

    // Log user input (for Ctrl+O LogBrowser chat category)
    streamLogger?.logUserInput(userMessage);

    // Set initial session name from user message (will be overridden by Planning LLM title if available)
    if (!sessionManager.getCurrentSessionName()) {
      const truncated = userMessage.length > 30 ? userMessage.substring(0, 30) + '...' : userMessage;
      sessionManager.setCurrentSessionName(truncated);
    }

    // Log planning start
    streamLogger?.logPlanningStart(userMessage, {
      messageCount: messages.length,
      model: configManager.getCurrentModel()?.name,
    });

    // Reset state - clear previous TODOs when starting new planning
    isInterruptedRef.current = false;
    callbacks.setIsInterrupted(false);
    callbacks.setTodos([]);  // Clear previous TODOs at start
    callbacks.setExecutionPhase('planning');
    callbacks.setCurrentActivity('Planning tasks');

    // Local TODO state
    let currentTodos: TodoItem[] = [];

    try {
      if (isInterruptedRef.current) {
        throw new Error('INTERRUPTED');
      }

      let currentMessages = messages;

      // 1. Generate TODO list
      callbacks.setCurrentActivity('Thinking');
      const planningLLM = new PlanningLLM(llmClient);

      // Connect ask-user callback for planning phase clarification
      if (callbacks.askUser) {
        planningLLM.setAskUserCallback(callbacks.askUser);
      }

      const planResult = await planningLLM.generateTODOList(userMessage, currentMessages);

      // Add clarification messages to history (ask_to_user Q&A from planning phase)
      if (planResult.clarificationMessages?.length) {
        currentMessages = [...currentMessages, ...planResult.clarificationMessages];
        callbacks.setMessages([...currentMessages]);
        logger.flow('Added planning clarification messages to history', {
          count: planResult.clarificationMessages.length,
        });
      }

      // Check for direct response (no planning needed)
      if (planResult.directResponse) {
        logger.flow('Direct response - no execution needed');

        // Log planning end (direct response)
        streamLogger?.logPlanningEnd(0, [], true, Date.now() - planningStartTime);
        // Log assistant response for direct response (was missing)
        streamLogger?.logAssistantResponse(planResult.directResponse);

        // Check if last message is already the same user request (avoid duplicate)
        const lastMsg = currentMessages[currentMessages.length - 1];
        const needsUserMessage = !(lastMsg?.role === 'user' && lastMsg?.content === userMessage);
        const updatedMessages: Message[] = needsUserMessage
          ? [
              ...currentMessages,
              { role: 'user' as const, content: userMessage },
              { role: 'assistant' as const, content: planResult.directResponse }
            ]
          : [
              ...currentMessages,
              { role: 'assistant' as const, content: planResult.directResponse }
            ];
        // Emit to UI log
        emitAssistantResponse(planResult.directResponse);
        // Update messages state
        callbacks.setMessages([...updatedMessages]);
        sessionManager.autoSaveCurrentSession(updatedMessages);
        callbacks.setExecutionPhase('idle');
        logger.exit('PlanExecutor.executePlanMode', { directResponse: true });
        return;
      }

      currentTodos = planResult.todos;

      // Update session name with planning title
      if (planResult.title) {
        sessionManager.setCurrentSessionName(planResult.title);
      }

      // Log planning end (TODOs created)
      streamLogger?.logPlanningEnd(
        currentTodos.length,
        currentTodos.map(t => ({ id: t.id, title: t.title, status: t.status })),
        false,
        Date.now() - planningStartTime
      );

      logger.vars(
        { name: 'todoCount', value: currentTodos.length }
      );

      // Update UI with TODOs
      callbacks.setTodos(currentTodos);
      emitPlanCreated(currentTodos.map(t => t.title));

      const planMessage = `📋 Created ${currentTodos.length} tasks. Starting execution...`;
      // Save history before adding userMessage + planMessage (for flatten without duplication)
      const historyBeforeExecution = [...currentMessages];
      // Check if last message is already the same user request (avoid duplicate)
      const lastMsgForPlan = currentMessages[currentMessages.length - 1];
      const needsUserMessageForPlan = !(lastMsgForPlan?.role === 'user' && lastMsgForPlan?.content === userMessage);
      currentMessages = needsUserMessageForPlan
        ? [
            ...currentMessages,
            { role: 'user' as const, content: userMessage },
            { role: 'assistant' as const, content: planMessage }
          ]
        : [
            ...currentMessages,
            { role: 'assistant' as const, content: planMessage }
          ];
      callbacks.setMessages(currentMessages);

      // Save session immediately after planning (before execution starts)
      // This ensures interrupted executions still have the session saved
      sessionManager.autoSaveCurrentSession(currentMessages);

      // 2. Setup TODO callbacks (with background auto-sync)
      this.setupTodoCallbacks(currentTodos, callbacks, (updated) => {
        currentTodos = updated;
      });

      // 3. Execute (single call - chatCompletionWithTools handles loop internally)
      callbacks.setExecutionPhase('executing');
      const tools = toolRegistry.getLLMToolDefinitions();

      // Prepare system message (with conditional Git rules if .git exists)
      const hasSystemMessage = currentMessages.some(m => m.role === 'system');
      if (!hasSystemMessage) {
        currentMessages = [
          { role: 'system' as const, content: buildSystemPrompt() },
          ...currentMessages
        ];
      }

      if (isInterruptedRef.current) {
        throw new Error('INTERRUPTED');
      }

      // Update activity
      const activeTodo = findActiveTodo(currentTodos);
      callbacks.setCurrentActivity(activeTodo?.title || 'Working on tasks');

      // Build rebuildMessages callback for per-iteration message reconstruction
      //  LLM  [system, user(<CURRENT_TASK> + <CONVERSATION_HISTORY> + <CURRENT_REQUEST>)]  
      const systemPrompt = buildSystemPrompt();
      const hasVision = toolRegistry.isToolGroupEnabled('vision');
      const criticalReminders = getCriticalReminders(hasVision, process.cwd(), getWindowsUserDesktopPath() || undefined);
      let baseHistory: Message[] = [...historyBeforeExecution, { role: 'assistant' as const, content: planMessage }];

      const rebuildMessages = (toolLoopMessages: Message[]): Message[] => {
        // userMessage history   (won   )
        const allMessages = [...baseHistory, { role: 'user' as const, content: userMessage }, ...toolLoopMessages];

        // HISTORY =   , CURRENT_REQUEST =  
        const historyMessages = allMessages.slice(0, -1);
        const lastMsg = allMessages[allMessages.length - 1]!; // allMessages always has at least userMessage
        const lastContent = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
        const lastTag = lastMsg.role === 'tool' ? '[TOOL_RESULT]' : lastMsg.role === 'user' ? '[USER]' : `[${lastMsg.role.toUpperCase()}]`;

        const historyText = flattenMessagesToHistory(historyMessages);
        const todoContext = buildTodoContext(currentTodos); //   TODO 

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

      // Initial messages (same as rebuildMessages([]))
      const messagesForLLM = rebuildMessages([]);

      // LLM call with per-iteration message rebuilding
      //  tool loop iteration rebuildMessages   TODO + history 
      const result = await llmClient.chatCompletionWithTools(messagesForLLM, tools, {
        getPendingMessage: callbacks.getPendingMessage,
        clearPendingMessage: callbacks.clearPendingMessage,
        askUser: callbacks.askUser,
        rebuildMessages,
        onAfterToolExecution: async (loopMessages) => {
          // Electron parity: proactive auto-compact at 70% threshold inside tool loop
          const model = configManager.getCurrentModel();
          const maxTokens = model?.maxTokens || 128000;
          if (!contextTracker.shouldTriggerAutoCompact(maxTokens)) return;

          const usage = contextTracker.getContextUsage(maxTokens);
          logger.flow('Auto-compact triggered during tool loop', { usagePercentage: usage.usagePercentage });
          callbacks.setExecutionPhase('compacting');
          callbacks.setCurrentActivity('Compacting context');

          const fullMessages = [...baseHistory, ...loopMessages];
          const compactManager = new CompactManager(llmClient);
          const compactResult = await compactManager.compact(fullMessages, {
            todos: currentTodos,
            workingDirectory: process.cwd(),
          });

          if (compactResult.success && compactResult.compactedSummary) {
            const lastTwo = fullMessages.slice(-2);
            const compactedBase = buildCompactedMessages(compactResult.compactedSummary, {
              workingDirectory: process.cwd(),
            });

            // Update baseHistory for rebuildMessages closure
            baseHistory = [...compactedBase, ...lastTwo];
            loopMessages.length = 0;

            // Update currentMessages for session storage
            currentMessages = [...compactedBase, ...lastTwo, { role: 'user' as const, content: userMessage }];
            callbacks.setMessages([...currentMessages]);
            sessionManager.autoSaveCurrentSession(currentMessages);

            // Reset context tracker with estimated token count
            const preview = rebuildMessages(loopMessages);
            const totalContent = preview
              .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
              .join('');
            contextTracker.reset(contextTracker.estimateTokens(totalContent));

            emitCompact(compactResult.originalMessageCount, compactResult.newMessageCount);
            logger.flow('Auto-compact completed in tool loop', { preservedMessages: 2 });
          }

          callbacks.setExecutionPhase('executing');
        },
      });

      // allMessages now contains only tool loop messages (no system/user prefix)
      const newMessages = result.allMessages.filter(m => m.role !== 'system');
      currentMessages = [...currentMessages, ...newMessages];
      callbacks.setMessages([...currentMessages]);
      // Sync todos to sessionManager before save (React useEffect may not have fired yet)
      sessionManager.setTodos(currentTodos);
      sessionManager.autoSaveCurrentSession(currentMessages);

      // Check for auto-compact after completion (fallback if threshold wasn't hit during loop)
      await this.checkAndPerformAutoCompact(
        llmClient,
        currentMessages,
        currentTodos,
        callbacks,
        (updated) => { currentMessages = updated; }
      );

      // 4. Completion - LLM's final response is already in currentMessages
      const stats = getTodoStats(currentTodos);
      sessionManager.setTodos(currentTodos);
      sessionManager.autoSaveCurrentSession(currentMessages);

      logger.exit('PlanExecutor.executePlanMode', { success: true, ...stats });
    } catch (error) {
      if (error instanceof Error && error.message === 'INTERRUPTED') {
        logger.flow('Plan mode interrupted by user');
        callbacks.setMessages((prev: Message[]) => {
          const updatedMessages: Message[] = [
            ...prev,
            { role: 'assistant' as const, content: '[ABORTED BY USER]' }
          ];
          sessionManager.autoSaveCurrentSession(updatedMessages);
          return updatedMessages;
        });
        return;
      }

      // LLM  retry   → retryPending  UI 
      if (error instanceof LLMRetryExhaustedError) {
        logger.error('LLM retry exhausted - notifying user', { error: error.message });
        callbacks.setMessages((prev: Message[]) => {
          const updatedMessages: Message[] = [
            ...prev,
            { role: 'assistant' as const, content: `LLM   .\n6  + 2   .\n\nEnter  .` }
          ];
          sessionManager.autoSaveCurrentSession(updatedMessages);
          return updatedMessages;
        });
        callbacks.setRetryPending?.(true);
        return;
      }

      logger.error('Plan mode execution failed', error as Error);
      const cm = configManager.getCurrentModel();
      reportError(error, { type: 'execution', method: 'executePlanMode', modelId: cm?.id, modelName: cm?.name }).catch(() => {});
      const errorMessage = formatErrorMessage(error);

      callbacks.setMessages((prev: Message[]) => {
        //      
        try { updateRecentMessagesForTelemetry(prev); } catch { /* ignore */ }
        const updatedMessages: Message[] = [
          ...prev,
          { role: 'assistant' as const, content: `Execution error:\n\n${errorMessage}` }
        ];
        sessionManager.autoSaveCurrentSession(updatedMessages);
        return updatedMessages;
      });
    } finally {
      callbacks.setExecutionPhase('idle');
      clearTodoCallbacks();
      clearFinalResponseCallbacks();


    }
  }

  /**
   * TODO  
   */
  async resumeTodoExecution(
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    todos: TodoItem[],
    isInterruptedRef: { current: boolean },
    callbacks: StateCallbacks
  ): Promise<void> {
    logger.enter('PlanExecutor.resumeTodoExecution', { messageLength: userMessage.length, todoCount: todos.length });

    // Log user input (for Ctrl+O LogBrowser chat category)
    const streamLogger = getStreamLogger();
    streamLogger?.logUserInput(userMessage);



    // Reset state
    isInterruptedRef.current = false;
    callbacks.setIsInterrupted(false);
    callbacks.setExecutionPhase('executing');
    callbacks.setCurrentActivity('Resuming execution');

    let currentTodos = [...todos];

    try {
      // Add user message
      let currentMessages: Message[] = [
        ...messages,
        { role: 'user' as const, content: userMessage }
      ];
      callbacks.setMessages(currentMessages);

      // Setup TODO callbacks
      this.setupTodoCallbacks(currentTodos, callbacks, (updated) => {
        currentTodos = updated;
      });

      // Get tools from registry
      const tools = toolRegistry.getLLMToolDefinitions();

      // Ensure system message (with conditional Git rules if .git exists)
      const hasSystemMessage = currentMessages.some(m => m.role === 'system');
      if (!hasSystemMessage) {
        currentMessages = [
          { role: 'system' as const, content: buildSystemPrompt() },
          ...currentMessages
        ];
      }

      if (isInterruptedRef.current) {
        throw new Error('INTERRUPTED');
      }

      const activeTodo = findActiveTodo(currentTodos);
      callbacks.setCurrentActivity(activeTodo?.title || 'Working on tasks');

      // Build rebuildMessages callback for per-iteration message reconstruction
      const systemPrompt = buildSystemPrompt();
      const hasVision = toolRegistry.isToolGroupEnabled('vision');
      const criticalReminders = getCriticalReminders(hasVision, process.cwd(), getWindowsUserDesktopPath() || undefined);
      let baseHistory: Message[] = [...messages]; // messages param = history without current userMessage

      const rebuildMessages = (toolLoopMessages: Message[]): Message[] => {
        // userMessage history   (won   )
        const allMessages = [...baseHistory, { role: 'user' as const, content: userMessage }, ...toolLoopMessages];

        // HISTORY =   , CURRENT_REQUEST =  
        const historyMessages = allMessages.slice(0, -1);
        const lastMsg = allMessages[allMessages.length - 1]!; // allMessages always has at least userMessage
        const lastContent = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
        const lastTag = lastMsg.role === 'tool' ? '[TOOL_RESULT]' : lastMsg.role === 'user' ? '[USER]' : `[${lastMsg.role.toUpperCase()}]`;

        const historyText = flattenMessagesToHistory(historyMessages);
        const todoContext = buildTodoContext(currentTodos); //   TODO 

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

      // Initial messages (same as rebuildMessages([]))
      const messagesForLLM = rebuildMessages([]);

      // LLM call with per-iteration message rebuilding
      const result = await llmClient.chatCompletionWithTools(messagesForLLM, tools, {
        getPendingMessage: callbacks.getPendingMessage,
        clearPendingMessage: callbacks.clearPendingMessage,
        askUser: callbacks.askUser,
        rebuildMessages,
        onAfterToolExecution: async (loopMessages) => {
          // Electron parity: proactive auto-compact at 70% threshold inside tool loop
          const model = configManager.getCurrentModel();
          const maxTokens = model?.maxTokens || 128000;
          if (!contextTracker.shouldTriggerAutoCompact(maxTokens)) return;

          const usage = contextTracker.getContextUsage(maxTokens);
          logger.flow('Auto-compact triggered during resume tool loop', { usagePercentage: usage.usagePercentage });
          callbacks.setExecutionPhase('compacting');
          callbacks.setCurrentActivity('Compacting context');

          const fullMessages = [...baseHistory, ...loopMessages];
          const compactManager = new CompactManager(llmClient);
          const compactResult = await compactManager.compact(fullMessages, {
            todos: currentTodos,
            workingDirectory: process.cwd(),
          });

          if (compactResult.success && compactResult.compactedSummary) {
            const lastTwo = fullMessages.slice(-2);
            const compactedBase = buildCompactedMessages(compactResult.compactedSummary, {
              workingDirectory: process.cwd(),
            });

            baseHistory = [...compactedBase, ...lastTwo];
            loopMessages.length = 0;

            currentMessages = [...compactedBase, ...lastTwo, { role: 'user' as const, content: userMessage }];
            callbacks.setMessages([...currentMessages]);
            sessionManager.autoSaveCurrentSession(currentMessages);

            const preview = rebuildMessages(loopMessages);
            const totalContent = preview
              .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
              .join('');
            contextTracker.reset(contextTracker.estimateTokens(totalContent));

            emitCompact(compactResult.originalMessageCount, compactResult.newMessageCount);
            logger.flow('Auto-compact completed in resume tool loop', { preservedMessages: 2 });
          }

          callbacks.setExecutionPhase('executing');
        },
      });

      // allMessages now contains only tool loop messages (no system/user prefix)
      const newMessages = result.allMessages.filter(m => m.role !== 'system');
      currentMessages = [...currentMessages, ...newMessages];
      callbacks.setMessages([...currentMessages]);
      sessionManager.autoSaveCurrentSession(currentMessages);

      // Check for auto-compact after completion (fallback if threshold wasn't hit during loop)
      await this.checkAndPerformAutoCompact(
        llmClient,
        currentMessages,
        currentTodos,
        callbacks,
        (updated) => { currentMessages = updated; }
      );

      // Completion - LLM's final response is already in currentMessages
      sessionManager.autoSaveCurrentSession(currentMessages);

      logger.exit('PlanExecutor.resumeTodoExecution', { success: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'INTERRUPTED') {
        logger.flow('Resume interrupted by user');
        callbacks.setMessages((prev: Message[]) => {
          const updatedMessages: Message[] = [
            ...prev,
            { role: 'assistant' as const, content: '[ABORTED BY USER]' }
          ];
          sessionManager.autoSaveCurrentSession(updatedMessages);
          return updatedMessages;
        });
        return;
      }

      // LLM  retry   → retryPending  UI 
      if (error instanceof LLMRetryExhaustedError) {
        logger.error('LLM retry exhausted during resume - notifying user', { error: error.message });
        callbacks.setMessages((prev: Message[]) => {
          const updatedMessages: Message[] = [
            ...prev,
            { role: 'assistant' as const, content: `LLM   .\n6  + 2   .\n\nEnter  .` }
          ];
          sessionManager.autoSaveCurrentSession(updatedMessages);
          return updatedMessages;
        });
        callbacks.setRetryPending?.(true);
        return;
      }

      logger.error('Resume execution failed', error as Error);
      const cm2 = configManager.getCurrentModel();
      reportError(error, { type: 'execution', method: 'resumeTodoExecution', modelId: cm2?.id, modelName: cm2?.name }).catch(() => {});
      callbacks.setMessages((prev: Message[]) => [...prev, {
        role: 'assistant' as const,
        content: `Execution error:\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      }]);
    } finally {
      callbacks.setExecutionPhase('idle');
      clearTodoCallbacks();
      clearFinalResponseCallbacks();


    }
  }

  /**
   * Auto Mode  (Planning   )
   *    -   Plan Mode 
   */
  async executeAutoMode(
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    _todos: TodoItem[],
    isInterruptedRef: { current: boolean },
    callbacks: StateCallbacks
  ): Promise<void> {
    logger.enter('PlanExecutor.executeAutoMode', { messageLength: userMessage.length });

    // All requests are now handled via Plan Mode
    // Classification and Direct Mode have been removed
    await this.executePlanMode(userMessage, llmClient, messages, isInterruptedRef, callbacks);

    logger.exit('PlanExecutor.executeAutoMode');
  }

  /**
   *   
   */
  async performCompact(
    llmClient: LLMClient,
    messages: Message[],
    todos: TodoItem[],
    callbacks: StateCallbacks
  ): Promise<CompactResult> {
    logger.enter('PlanExecutor.performCompact', { messageCount: messages.length });
    callbacks.setExecutionPhase('compacting');
    callbacks.setCurrentActivity('Compacting conversation');

    try {
      const compactManager = new CompactManager(llmClient);

      const result = await compactManager.compact(messages, {
        todos,
        workingDirectory: process.cwd(),
        currentModel: configManager.getCurrentModel()?.name,
        recentFiles: contextTracker.getRecentFiles(),
      });

      if (result.success && result.compactedSummary) {
        const lastTwoMessages = messages.slice(-2);

        const compactedBase = buildCompactedMessages(result.compactedSummary, {
          workingDirectory: process.cwd(),
        });

        const finalMessages = [...compactedBase, ...lastTwoMessages];

        // Estimate token count for compacted messages (for UI display)
        const totalContent = finalMessages
          .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
          .join('');
        const estimatedTokens = contextTracker.estimateTokens(totalContent);

        callbacks.setMessages(finalMessages);
        contextTracker.reset(estimatedTokens);
        sessionManager.autoSaveCurrentSession(finalMessages);

        emitCompact(result.originalMessageCount, finalMessages.length);

        logger.flow('Compact completed successfully', { preservedMessages: 2 });

        // Return with compactedMessages for caller to use
        logger.exit('PlanExecutor.performCompact', { success: true });
        return {
          ...result,
          compactedMessages: finalMessages,
        };
      }

      logger.exit('PlanExecutor.performCompact', { success: result.success });
      return result;

    } catch (error) {
      logger.error('Compact failed', error as Error);
      return {
        success: false,
        originalMessageCount: messages.length,
        newMessageCount: messages.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      callbacks.setExecutionPhase('idle');
      callbacks.setCurrentActivity('Idle');
    }
  }

  /**
   *    
   */
  shouldAutoCompact(): boolean {
    const model = configManager.getCurrentModel();
    const maxTokens = model?.maxTokens || 128000;
    return contextTracker.shouldTriggerAutoCompact(maxTokens);
  }

  /**
   *    return
   */
  getContextRemainingPercent(): number {
    const model = configManager.getCurrentModel();
    const maxTokens = model?.maxTokens || 128000;
    const usage = contextTracker.getContextUsage(maxTokens);
    return usage.remainingPercentage;
  }

  /**
   *    return
   */
  getContextUsageInfo(): { tokens: number; percent: number } {
    const model = configManager.getCurrentModel();
    const maxTokens = model?.maxTokens || 128000;
    const usage = contextTracker.getContextUsage(maxTokens);
    return {
      tokens: usage.currentTokens,
      percent: usage.usagePercentage,
    };
  }

  /**
   * TODO   ( )
   * write_todos:    
   * final_response:    ( TODO  )
   */
  private setupTodoCallbacks(
    currentTodos: TodoItem[],
    callbacks: StateCallbacks,
    updateLocalTodos: (todos: TodoItem[]) => void
  ): void {
    // Mutable reference for getTodos callback
    let todosRef = currentTodos;

    // write_todos callback:   
    setTodoWriteCallback(async (newTodos: TodoInput[]) => {
      // Cap TODOs at 3 to prevent executor from creating excessive TODOs
      const MAX_WRITE_TODOS = 3;
      if (newTodos.length > MAX_WRITE_TODOS) {
        logger.info(`write_todos: Trimming ${newTodos.length} TODOs to ${MAX_WRITE_TODOS}`);
        newTodos = newTodos.slice(0, MAX_WRITE_TODOS);
      }

      // Find status changes for UI events
      const oldStatusMap = new Map(todosRef.map(t => [t.id, t.status]));

      // Convert to TodoItem format
      const updatedTodos: TodoItem[] = newTodos.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
      }));

      // Emit events for status changes
      for (const todo of updatedTodos) {
        const oldStatus = oldStatusMap.get(todo.id);
        if (oldStatus !== todo.status) {
          if (todo.status === 'completed') {
            emitTodoComplete(todo.title);
          } else if (todo.status === 'failed') {
            emitTodoFail(todo.title);
          } else if (todo.status === 'in_progress') {
            emitTodoStart(todo.title);
          }
        }
      }

      // Update both local ref and external state
      todosRef = updatedTodos;
      updateLocalTodos(updatedTodos);
      callbacks.setTodos([...updatedTodos]);

      return true;
    });

    // getTodos callback for final_response tool
    setGetTodosCallback(() => todosRef);

    // finalResponse callback - emit as assistant response
    setFinalResponseCallback((message: string) => {
      emitAssistantResponse(message);
    });
  }

  /**
   *      ( )
   */
  private async checkAndPerformAutoCompact(
    llmClient: LLMClient,
    currentMessages: Message[],
    currentTodos: TodoItem[],
    callbacks: StateCallbacks,
    updateLocalMessages: (messages: Message[]) => void
  ): Promise<void> {
    const model = configManager.getCurrentModel();
    const maxTokens = model?.maxTokens || 128000;

    if (contextTracker.shouldTriggerAutoCompact(maxTokens)) {
      logger.flow('Auto-compact triggered during execution');
      callbacks.setExecutionPhase('compacting');
      callbacks.setCurrentActivity('Compacting context');

      const compactManager = new CompactManager(llmClient);
      const compactResult = await compactManager.compact(currentMessages, {
        todos: currentTodos,
        workingDirectory: process.cwd(),
      });

      if (compactResult.success && compactResult.compactedSummary) {
        const lastTwoMessages = currentMessages.slice(-2);
        const newMessages = [
          ...buildCompactedMessages(compactResult.compactedSummary, {
            workingDirectory: process.cwd(),
          }),
          ...lastTwoMessages,
        ];
        updateLocalMessages(newMessages);
        callbacks.setMessages([...newMessages]);
        emitCompact(compactResult.originalMessageCount, compactResult.newMessageCount);
      }

      callbacks.setExecutionPhase('executing');
    }
  }
}

// singleton  ( )
export const planExecutor = new PlanExecutor();
