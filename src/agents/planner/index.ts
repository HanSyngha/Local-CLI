/**
 * Planning Agent
 *
 * System Planning Agent with full shell access.
 * - Clarify requirements with ask_to_user
 * - Create comprehensive TODO lists for Execution LLM
 */

import { LLMClient } from '../../core/llm/llm-client.js';
import { Message, TodoItem, PlanningResult, TodoStatus } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { buildPlanningSystemPrompt } from '../../prompts/agents/planning.js';
import { toolRegistry } from '../../tools/registry.js';
import { getWindowsUserDesktopPath } from '../../utils/platform-utils.js';
import { flattenMessagesToHistory } from '../../orchestration/utils.js';
import { reportError } from '../../core/telemetry/error-reporter.js';
import { configManager } from '../../core/config/config-manager.js';
import { LLMRetryExhaustedError } from '../../errors/llm.js';
import {
  AskUserResponse,
  AskUserCallback,
} from '../../tools/llm/simple/user-interaction-tools.js';

/**
 * Planning LLM
 * System Planning Agent that converts user requests into executable TODO lists
 * Supports ask_to_user for requirement clarification
 */
export class PlanningLLM {
  private llmClient: LLMClient;
  private askUserCallback: AskUserCallback | null = null;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * Set the ask-user callback for Planning LLM
   * This enables the ask_to_user tool during planning
   */
  setAskUserCallback(callback: AskUserCallback): void {
    logger.flow('Setting ask-user callback for Planning LLM');
    this.askUserCallback = callback;
  }

  /**
   * Clear ask-user callback
   */
  clearAskUserCallback(): void {
    logger.flow('Clearing ask-user callback for Planning LLM');
    this.askUserCallback = null;
  }

  /**
   * Convert user request to TODO list
   * Uses actual tool definitions for Planning LLM
   * Supports ask_to_user for requirement clarification (loops until final decision)
   * Returns clarificationMessages for caller to inject into conversation history
   * @param userRequest The user's request
   * @param contextMessages Optional context messages (e.g., conversation history)
   */
  async generateTODOList(
    userRequest: string,
    contextMessages?: Message[],
  ): Promise<PlanningResult> {
    // Build dynamic system prompt with available tools
    const toolSummary = toolRegistry.getToolSummaryForPlanning();
    const optionalToolsInfo = toolRegistry.getEnabledOptionalToolsInfo();
    let researchUrls: { name: string; url: string }[] | undefined;
    try {
      researchUrls = configManager.getConfig().researchUrls;
    } catch { /* config not loaded */ }
    const systemPrompt = buildPlanningSystemPrompt(toolSummary, optionalToolsInfo, getWindowsUserDesktopPath() || undefined, researchUrls);

    // Track clarification messages (ask_to_user Q&A) to return to caller
    const clarificationMessages: Message[] = [];

    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    // Flatten conversation history into chronological text with XML tags
    // This helps weaker LLMs distinguish history from current request
    if (contextMessages && contextMessages.length > 0) {
      const conversationMsgs = contextMessages.filter(m => m.role !== 'system');

      // Check if last context message is already the same user request (avoid duplicate in history)
      const lastContextMsg = conversationMsgs[conversationMsgs.length - 1];
      const isDuplicate = lastContextMsg?.role === 'user' && lastContextMsg?.content === userRequest;

      // If duplicate, flatten history WITHOUT the last message (it will go in CURRENT_REQUEST)
      const msgsToFlatten = isDuplicate ? conversationMsgs.slice(0, -1) : conversationMsgs;
      const historyText = flattenMessagesToHistory(msgsToFlatten);

      // Build user message with history + current request (always include CURRENT_REQUEST)
      let userContent = '';
      if (historyText) {
        userContent += `<CONVERSATION_HISTORY>\n${historyText}\n</CONVERSATION_HISTORY>\n\n`;
      }
      userContent += `<CURRENT_REQUEST>\n${userRequest}\n</CURRENT_REQUEST>`;
      messages.push({ role: 'user', content: userContent });
    } else {
      // No history - just current request
      messages.push({
        role: 'user',
        content: `<CURRENT_REQUEST>\n${userRequest}\n</CURRENT_REQUEST>`,
      });
    }

    // Get Planning tool definitions (ask_to_user, create_todos, respond_to_user)
    const planningTools = toolRegistry.getLLMPlanningToolDefinitions();

    const MAX_RETRIES = 5;
    const MAX_ASK_ITERATIONS = 2;
    let askIterations = 0;
    let lastError: Error | null = null;

    // Main planning loop - continues until create_todos or respond_to_user is called
    while (askIterations < MAX_ASK_ITERATIONS) {
      let shouldContinueMainLoop = false; // Track if we should continue after ask_to_user

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Add retry prompt if this is a retry attempt
          if (attempt > 1) {
            messages.push({
              role: 'user',
              content: `[RETRY ${attempt}/${MAX_RETRIES}] ⚠️ CRITICAL: You are the PLANNING LLM, not the Execution LLM.

You have ONLY 4 tools available:
1. 'ask_to_user' - To clarify ambiguous requirements (use FIRST if unclear)
2. 'create_todos' - For ANY action/implementation request
3. 'respond_to_user' - For pure knowledge questions/greetings only
4. 'tell_to_user' - To send a message and then continue with create_todos

❌ DO NOT use tools like 'write_todos', 'read_file', 'bash', etc. Those are for Execution LLM, NOT you.
❌ You saw those tools in conversation history, but they are NOT available to you.

Previous error: ${lastError?.message || 'Invalid response'}

Choose one of your 4 tools now.`,
            });
            logger.warn(`Planning LLM retry attempt ${attempt}/${MAX_RETRIES}`, { lastError: lastError?.message });
          }

          const response = await this.llmClient.chatCompletion({
            messages,
            tools: planningTools,
            tool_choice: 'required',
            temperature: 0.7,
          });

          // Debug: Log raw response structure
          const choicesCount = response.choices?.length ?? 0;
          const message = response.choices?.[0]?.message;
          const toolCalls = message?.tool_calls;
          const finishReason = response.choices?.[0]?.finish_reason;

          logger.debug('Planning LLM response', {
            choicesCount,
            hasMessage: !!message,
            hasToolCalls: !!(toolCalls && toolCalls.length > 0),
            hasContent: !!message?.content,
            contentLength: message?.content?.length ?? 0,
            finishReason,
            toolCallsCount: toolCalls?.length ?? 0,
          });

          // Handle tool call
          if (toolCalls && toolCalls.length > 0) {
            const toolCall = toolCalls[0]!;
            const toolName = toolCall.function?.name;

            let toolArgs;
            try {
              toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
            } catch (error) {
              logger.warn('Failed to parse tool arguments', { args: toolCall.function?.arguments, error });
              reportError(error, { type: 'planningError', method: 'parseToolArguments' }).catch(() => {});
              lastError = error as Error;
              // Feed back the parse error to LLM so it can correct itself
              const rawPreview = typeof toolCall.function?.arguments === 'string'
                ? toolCall.function.arguments.substring(0, 300) : '(empty)';
              // Only include the failed tool_call (not all) to avoid orphaned tool_calls
              messages.push({
                role: 'assistant',
                content: message?.content || '',
                tool_calls: [toolCall],
              } as Message);
              messages.push({
                role: 'tool',
                content: `Error: Failed to parse tool arguments. ${error instanceof Error ? error.message : 'Invalid JSON'}\nYour raw input: ${rawPreview}\nRetry with valid JSON: {"question": "...", "options": ["A", "B"]}`,
                tool_call_id: toolCall.id,
              } as Message);
              continue; // Retry with feedback
            }

            // Handle ask_to_user - clarify requirements before planning
            if (toolName === 'ask_to_user') {
              logger.flow('Planning LLM asking user for clarification');

              const question = toolArgs.question as string;
              const options = toolArgs.options as string[];

              if (!question || !Array.isArray(options) || options.length < 2) {
                logger.warn('ask_to_user called with invalid parameters', { toolArgs });
                lastError = new Error('ask_to_user requires a question and 2-4 options');
                continue; // Retry
              }

              askIterations++;

              // Check if callback is available
              if (!this.askUserCallback) {
                logger.warn('ask_to_user called but no callback is set, forcing create_todos');
                messages.push({
                  role: 'assistant',
                  content: `[ask_to_user was called but user interaction is not available.]`,
                });
                messages.push({
                  role: 'user',
                  content: `User interaction is unavailable. You MUST call 'create_todos' now with your best judgment. Do NOT call ask_to_user again.`,
                });
                shouldContinueMainLoop = true;
                break; // Exit retry loop, continue main loop
              }

              try {
                // Record the assistant's question in history
                const assistantMsg: Message = {
                  role: 'assistant',
                  content: `[Clarification needed] ${question}\nOptions: ${options.join(', ')}`,
                };
                messages.push(assistantMsg);
                clarificationMessages.push(assistantMsg);

                // Call the UI callback to ask user
                const userResponse: AskUserResponse = await this.askUserCallback({ question, options });

                // Build user response text
                const userAnswerText = userResponse.isOther && userResponse.customText
                  ? userResponse.customText
                  : userResponse.selectedOption;

                // Record user's response in history
                const userMsg: Message = {
                  role: 'user',
                  content: `[User's answer] ${userAnswerText}`,
                };
                messages.push(userMsg);
                clarificationMessages.push(userMsg);

                logger.flow('User responded to clarification question', {
                  question,
                  answer: userAnswerText,
                  isCustom: userResponse.isOther,
                });

                // Continue main loop - LLM will process the answer and decide next step
                shouldContinueMainLoop = true;
                break; // Exit retry loop, continue main loop

              } catch (error) {
                logger.error('Error during ask_to_user', error as Error);
                reportError(error, { type: 'planningError', method: 'askToUser' }).catch(() => {});
                lastError = error as Error;
                // Continue retry loop
                continue;
              }
            }

            // Handle tell_to_user - send message and continue planning
            if (toolName === 'tell_to_user') {
              logger.flow('Planning LLM sending message to user via tell_to_user');
              const tellMessage = toolArgs.message as string;

              if (tellMessage) {
                const assistantMsg: Message = {
                  role: 'assistant',
                  content: tellMessage,
                };
                messages.push(assistantMsg);
                clarificationMessages.push(assistantMsg);
              }

              // Add instruction to call create_todos next
              messages.push({
                role: 'user',
                content: '[Message delivered] Now call create_todos to plan the tasks.',
              });

              askIterations++;
              shouldContinueMainLoop = true;
              break; // Exit retry loop, continue main loop
            }

            // Handle create_todos - final planning decision
            if (toolName === 'create_todos') {
              logger.flow('TODO list created via create_todos tool');

              // Validate todos is an array (handle string-wrapped JSON from LLM)
              let rawTodos = toolArgs.todos;

              // If todos is a string, try to parse it as JSON
              if (typeof rawTodos === 'string') {
                try {
                  rawTodos = JSON.parse(rawTodos);
                  logger.debug('Parsed string-wrapped todos array');
                } catch {
                  logger.warn('Failed to parse string todos as JSON', { todos: rawTodos });
                }
              }

              if (!Array.isArray(rawTodos)) {
                logger.warn('create_todos called with non-array todos', { toolArgs });
                lastError = new Error('Planning LLM returned invalid todos format (expected array).');
                continue; // Retry
              }

              // Cap TODOs at 2 — fewer TODOs = faster execution, less timeout risk
              const MAX_TODOS = 2;
              if (rawTodos.length > MAX_TODOS) {
                logger.info(`Trimming ${rawTodos.length} TODOs to ${MAX_TODOS}`);
                rawTodos = rawTodos.slice(0, MAX_TODOS);
              }

              const todos: TodoItem[] = rawTodos.map((todo: any, index: number) => ({
                id: todo.id || `todo-${Date.now()}-${index}`,
                title: todo.title || 'Untitled task',
                // First TODO starts as in_progress, rest are pending
                status: (index === 0 ? 'in_progress' : 'pending') as TodoStatus,
              }));

              return {
                title: toolArgs.title as string | undefined,
                todos,
                complexity: toolArgs.complexity || 'moderate',
                clarificationMessages: clarificationMessages.length > 0 ? clarificationMessages : undefined,
              };
            }

            // Handle respond_to_user - direct response without TODOs
            if (toolName === 'respond_to_user') {
              logger.flow('Direct response via respond_to_user tool');
              const responseText = toolArgs.response || '';

              if (!responseText) {
                logger.warn('respond_to_user called with empty response');
                lastError = new Error('Planning LLM returned empty response.');
                continue; // Retry
              }

              return {
                todos: [],
                complexity: 'simple',
                directResponse: responseText,
                clarificationMessages: clarificationMessages.length > 0 ? clarificationMessages : undefined,
              };
            }

            // Unknown tool - retry
            logger.warn(`Unknown tool called: ${toolName}`);
            lastError = new Error(`Invalid tool "${toolName}". You only have 4 tools: ask_to_user, create_todos, respond_to_user, or tell_to_user. Tools like write_todos are for Execution LLM, not Planning LLM.`);
            continue; // Retry
          }

          // No tool call - this should not happen with tool_choice: "required"
          // Some models (e.g. gpt-oss-120b via vLLM) ignore tool_choice and embed tool calls in content
          const contentOnly = message?.content;
          if (contentOnly) {
            // Fallback: try to extract tool call JSON from plain text content
            const extracted = this.extractToolCallFromContent(contentOnly);
            if (extracted) {
              logger.info(`Extracted tool call from plain text content (attempt ${attempt}/${MAX_RETRIES})`, {
                toolName: extracted.name,
              });
              // Directly handle extracted tool call
              if (extracted.name === 'create_todos' && Array.isArray(extracted.arguments?.todos)) {
                // Cap TODOs at 2 (same as main path)
                let extractedTodos = extracted.arguments.todos;
                if (extractedTodos.length > 2) {
                  logger.info(`Trimming extracted ${extractedTodos.length} TODOs to 2`);
                  extractedTodos = extractedTodos.slice(0, 2);
                }
                const todos: TodoItem[] = extractedTodos.map((todo: any, index: number) => ({
                  id: todo.id || `todo-${Date.now()}-${index}`,
                  title: todo.title || 'Untitled task',
                  status: (index === 0 ? 'in_progress' : 'pending') as TodoStatus,
                }));
                return {
                  todos,
                  complexity: extracted.arguments.complexity || 'moderate',
                  clarificationMessages: clarificationMessages.length > 0 ? clarificationMessages : undefined,
                };
              }
              if (extracted.name === 'respond_to_user' && extracted.arguments?.response) {
                return {
                  todos: [],
                  complexity: 'simple',
                  directResponse: extracted.arguments.response,
                  clarificationMessages: clarificationMessages.length > 0 ? clarificationMessages : undefined,
                };
              }
            }

            logger.warn(`Planning LLM returned content without tool call (attempt ${attempt}/${MAX_RETRIES})`, {
              contentPreview: contentOnly.substring(0, 100),
            });
            lastError = new Error(
              'You MUST call one of your tools: ask_to_user, create_todos, respond_to_user, or tell_to_user. Do NOT respond with plain text.'
            );
          } else {
            logger.warn(`Planning LLM returned no tool call and no content (attempt ${attempt}/${MAX_RETRIES})`);
            lastError = new Error('Planning LLM must use one of: ask_to_user, create_todos, respond_to_user, or tell_to_user');
          }
          // Continue to next retry
        } catch (error) {
          // LLMRetryExhaustedError: chatCompletion()  6   →  
          if (error instanceof LLMRetryExhaustedError) {
            throw error;
          }
          // Network or API error - will retry
          logger.warn(`Planning LLM error (attempt ${attempt}/${MAX_RETRIES}):`, error as Error);
          reportError(error, { type: 'planningError', method: 'generateTODOList', attempt }).catch(() => {});
          lastError = error as Error;
          // Continue to next retry
        }
      }

      // If ask_to_user was successful, continue main loop for next LLM call
      if (shouldContinueMainLoop) {
        continue;
      }

      // All retries exhausted without successful ask_to_user - break to fallback
      break;
    }

    // All retries exhausted (MAX_RETRIES=${MAX_RETRIES}) - use fallback
    logger.warn('All planning retries exhausted, using fallback TODO', { lastError: lastError?.message });
    if (lastError) {
      const cm = configManager.getCurrentModel();
      reportError(lastError, { type: 'planning', reason: 'retriesExhausted', modelId: cm?.id, modelName: cm?.name }).catch(() => {});
    }
    return {
      todos: [
        {
          id: `todo-${Date.now()}`,
          title: userRequest.length > 100 ? userRequest.substring(0, 100) + '...' : userRequest,
          status: 'in_progress',
        },
      ],
      complexity: 'simple',
      clarificationMessages: clarificationMessages.length > 0 ? clarificationMessages : undefined,
    };
  }

  /**
   * Extract tool call from plain text content.
   * Some models (e.g. gpt-oss-120b via vLLM) ignore tool_choice: 'required'
   * and embed tool calls as JSON within their text response.
   */
  private extractToolCallFromContent(content: string): { name: string; arguments: any } | null {
    const toolNames = ['create_todos', 'respond_to_user', 'ask_to_user', 'tell_to_user'];

    for (const toolName of toolNames) {
      // Pattern 1: {"name": "create_todos", "arguments": {...}}
      const funcPattern = new RegExp(
        `\\{[^{}]*"name"\\s*:\\s*"${toolName}"[^{}]*"arguments"\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*\\}`,
      );
      const funcMatch = content.match(funcPattern);
      if (funcMatch?.[1]) {
        try {
          const args = JSON.parse(funcMatch[1]);
          logger.debug(`Extracted tool call via function pattern: ${toolName}`);
          return { name: toolName, arguments: args };
        } catch { /* continue */ }
      }

      // Pattern 2: Tool name followed by a JSON block: create_todos({...}) or create_todos: {...}
      const directPattern = new RegExp(
        `${toolName}\\s*[:(\\[]\\s*(\\{[\\s\\S]*?\\})`,
      );
      const directMatch = content.match(directPattern);
      if (directMatch?.[1]) {
        try {
          const args = JSON.parse(directMatch[1]);
          logger.debug(`Extracted tool call via direct pattern: ${toolName}`);
          return { name: toolName, arguments: args };
        } catch { /* continue */ }
      }
    }

    // Pattern 3: Any JSON block containing "todos" array (likely create_todos)
    const todosPattern = /\{[\s\S]*?"todos"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/;
    const todosMatch = content.match(todosPattern);
    if (todosMatch?.[0]) {
      try {
        const parsed = JSON.parse(todosMatch[0]);
        if (Array.isArray(parsed.todos)) {
          logger.debug('Extracted create_todos from raw JSON block with todos array');
          return { name: 'create_todos', arguments: parsed };
        }
      } catch { /* continue */ }
    }

    return null;
  }
}

export default PlanningLLM;
