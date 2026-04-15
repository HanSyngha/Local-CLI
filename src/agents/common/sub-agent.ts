/**
 * Sub-Agent
 *
 * Generic iteration loop for all sub-agents (Office, Browser, etc.).
 * Runs an LLM with specialized tools + complete tool in a loop.
 *
 * When planningPrompt is set:
 *   Planning Phase → Execution Phase (rebuildMessages pattern, like main agent)
 *   Every iteration rebuilds [system, user(plan+history+instruction), ...recentMessages]
 *   so that even weak LLMs always see the plan and know where they are.
 *
 * When planningPrompt is NOT set:
 *   Simple execution loop (existing behavior, no message rebuild).
 */

import { LLMClient } from '../../core/llm/llm-client.js';
import { Message, ToolDefinition } from '../../types/index.js';
import { LLMSimpleTool, ToolResult } from '../../tools/types.js';
import { COMPLETE_TOOL_DEFINITION } from './complete-tool.js';
import { configManager } from '../../core/config/config-manager.js';
import { logger } from '../../utils/logger.js';
import { getJsonStreamLogger } from '../../utils/json-stream-logger.js';
import { reportError } from '../../core/telemetry/error-reporter.js';
import { ContextLengthError } from '../../errors/llm.js';

// Global callback for SubAgent event logging (opt-in, used by pipe-runner -ps mode)
type ToolCallLoggerFn = (appName: string, toolName: string, args: Record<string, unknown>, resultText: string, success: boolean, iteration: number, totalCalls: number) => void;
type PhaseLoggerFn = (appName: string, phase: string, detail: string) => void;
let globalToolCallLogger: ToolCallLoggerFn | null = null;
let globalPhaseLogger: PhaseLoggerFn | null = null;

export function setSubAgentToolCallLogger(fn: ToolCallLoggerFn | null): void {
  globalToolCallLogger = fn;
}

export function setSubAgentPhaseLogger(fn: PhaseLoggerFn | null): void {
  globalPhaseLogger = fn;
}

export function getSubAgentToolCallLogger(): ToolCallLoggerFn | null {
  return globalToolCallLogger;
}

export function getSubAgentPhaseLogger(): PhaseLoggerFn | null {
  return globalPhaseLogger;
}

/** Log a sub-agent event to the JSON stream logger with 'subagent' category */
function streamLog(appName: string, type: 'tool_start' | 'tool_end' | 'planning_start' | 'planning_end' | 'info' | 'error' | 'debug', content: string, metadata?: Record<string, unknown>): void {
  const streamLogger = getJsonStreamLogger();
  if (!streamLogger) return;
  streamLogger.log({
    timestamp: new Date().toISOString(),
    type,
    content: `[SubAgent:${appName}] ${content}`,
    category: 'subagent',
    metadata,
  });
}

export interface SubAgentConfig {
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  planningPrompt?: string;
  enhancementPrompt?: string;
  minToolCallsBeforeComplete?: number;
  /** Agent-specific critical rules injected into rebuildMessages. If not set, generic rules are used. */
  executionRules?: string;
}

export class SubAgent {
  private llmClient: LLMClient;
  private appName: string;
  private tools: LLMSimpleTool[];
  private toolMap: Map<string, LLMSimpleTool>;
  private systemPrompt: string;
  private maxIterations: number;
  private temperature: number;
  private planningPrompt?: string;
  private enhancementPrompt?: string;
  private minToolCallsBeforeComplete: number;
  private executionRules?: string;
  private maxTokens: number;

  constructor(
    llmClient: LLMClient,
    appName: string,
    tools: LLMSimpleTool[],
    systemPrompt: string,
    config?: SubAgentConfig
  ) {
    this.llmClient = llmClient;
    this.appName = appName;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxIterations = config?.maxIterations ?? 15;
    this.temperature = config?.temperature ?? 0.3;
    const modelContext = configManager.getCurrentModel()?.maxTokens || 128000;
    this.maxTokens = config?.maxTokens ?? Math.min(8192, Math.floor(modelContext * 0.1));
    this.planningPrompt = config?.planningPrompt;
    this.enhancementPrompt = config?.enhancementPrompt;
    this.minToolCallsBeforeComplete = config?.minToolCallsBeforeComplete ?? 0;
    this.executionRules = config?.executionRules;

    // Build tool lookup map for fast access
    this.toolMap = new Map();
    for (const tool of tools) {
      this.toolMap.set(tool.definition.function.name, tool);
    }
  }

  /**
   * Run the sub-agent with the given instruction.
   * Uses rebuildMessages pattern when plan exists (main agent pattern).
   */
  async run(instruction: string): Promise<ToolResult> {
    const startTime = Date.now();
    let iterations = 0;
    let totalToolCalls = 0;

    logger.enter(`SubAgent[${this.appName}].run`);
    logger.info(`Sub-agent starting`, {
      appName: this.appName,
      toolCount: this.tools.length,
      instruction: instruction.slice(0, 100),
    });
    streamLog(this.appName, 'info', `Starting (tools: ${this.tools.length}, maxIter: ${this.maxIterations})`, {
      instruction: instruction.slice(0, 300),
      tools: this.tools.map(t => t.definition.function.name),
    });

    // Instruction Enhancement Phase — dynamically generates topic-specific creative guidance
    let enhancedInstruction = instruction;
    if (this.enhancementPrompt) {
      if (globalPhaseLogger) globalPhaseLogger(this.appName, 'enhancement', 'Generating creative guidance...');
      streamLog(this.appName, 'planning_start', 'Enhancement phase started');
      const guidance = await this.enhanceInstruction(instruction);
      if (guidance) {
        enhancedInstruction = `${instruction}\n\n═══ CREATIVE GUIDANCE ═══\n${guidance}\n═══ END GUIDANCE ═══`;
        if (globalPhaseLogger) globalPhaseLogger(this.appName, 'enhancement', `Done (${guidance.length} chars)`);
        streamLog(this.appName, 'planning_end', `Enhancement done (${guidance.length} chars)`, { guidance: guidance.slice(0, 500) });
      } else {
        streamLog(this.appName, 'planning_end', 'Enhancement failed or empty');
      }
    }

    // Planning Phase — uses enhanced instruction for richer context
    let plan: string | null = null;
    if (this.planningPrompt) {
      if (globalPhaseLogger) globalPhaseLogger(this.appName, 'planning', 'Generating execution plan...');
      streamLog(this.appName, 'planning_start', 'Planning phase started');
      plan = await this.generatePlan(enhancedInstruction);
      if (plan) {
        if (globalPhaseLogger) globalPhaseLogger(this.appName, 'planning', `Done (${plan.length} chars)`);
        streamLog(this.appName, 'planning_end', `Plan generated (${plan.length} chars)`, { plan: plan.slice(0, 1000) });
      } else {
        streamLog(this.appName, 'planning_end', 'Planning failed, proceeding without plan');
      }
    }

    // Build tool definitions: app tools + complete tool
    const toolDefinitions: ToolDefinition[] = [
      ...this.tools.map((t) => t.definition),
      COMPLETE_TOOL_DEFINITION,
    ];

    // === Message management ===
    // Plan mode: rebuild messages each iteration (main agent pattern)
    //   historyText: flattened text of all past exchanges
    //   pendingMessages: most recent assistant+tool exchange (proper message objects)
    // Simple mode: single growing messages array (existing behavior)
    let historyText = '';
    let pendingMessages: Message[] = [];
    const simpleMessages: Message[] = plan
      ? []
      : [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: enhancedInstruction },
        ];
    let contextRecoveryAttempts = 0;
    const MAX_CONTEXT_RECOVERY = 3;

    // Execution iteration loop
    while (iterations < this.maxIterations) {
      iterations++;
      if (globalPhaseLogger) globalPhaseLogger(this.appName, 'execution', `Step ${iterations}/${this.maxIterations}`);
      logger.flow(`SubAgent[${this.appName}] iteration ${iterations}`);
      streamLog(this.appName, 'info', `Iteration ${iterations}/${this.maxIterations} (toolCalls: ${totalToolCalls})`);

      // Build messages for LLM call
      const messagesForLLM: Message[] = plan
        ? this.rebuildMessages(plan, instruction, historyText, pendingMessages)
        : simpleMessages;

      // Inject urgent save warning when running low on iterations (proportional to maxIterations)
      const remaining = this.maxIterations - iterations;
      const earlyThreshold = Math.max(3, Math.floor(this.maxIterations * 0.3));
      const emergencyThreshold = Math.max(2, Math.floor(this.maxIterations * 0.15));
      if (remaining <= earlyThreshold && remaining > emergencyThreshold) {
        const warning = `⚠️ WARNING: Only ${remaining} iteration(s) remaining out of ${this.maxIterations}! Finish your current work, SAVE the file, and call "complete". Do NOT start new content.`;
        messagesForLLM.push({ role: 'user' as const, content: warning });
        logger.warn(`SubAgent[${this.appName}] injected early save warning`, { remaining });
      } else if (remaining <= emergencyThreshold && remaining > 0) {
        const warning = `🚨 EMERGENCY: Only ${remaining} iteration(s) left! STOP building content NOW. SAVE the file immediately and call "complete". ALL UNSAVED WORK WILL BE LOST.`;
        messagesForLLM.push({ role: 'user' as const, content: warning });
        logger.warn(`SubAgent[${this.appName}] injected emergency save warning`, { remaining });
      }

      let response;
      try {
        response = await this.llmClient.chatCompletion({
          messages: messagesForLLM,
          tools: toolDefinitions,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        });
      } catch (error) {
        if (error instanceof ContextLengthError && contextRecoveryAttempts < MAX_CONTEXT_RECOVERY) {
          contextRecoveryAttempts++;
          // Progressive truncation: 50% → 25% → 10%
          const keepRatios = [0.5, 0.25, 0.1];
          const keepRatio = keepRatios[contextRecoveryAttempts - 1] ?? 0.1;

          logger.warn(`SubAgent[${this.appName}] context overflow recovery attempt ${contextRecoveryAttempts}/${MAX_CONTEXT_RECOVERY}`, {
            iteration: iterations,
            totalToolCalls,
            keepRatio,
            historyLength: historyText.length,
            simpleMessagesCount: simpleMessages.length,
          });
          streamLog(this.appName, 'error', `Context overflow recovery ${contextRecoveryAttempts}/${MAX_CONTEXT_RECOVERY} (keep ${Math.round(keepRatio * 100)}%)`);

          if (plan) {
            // Plan mode: progressively truncate historyText + clear/truncate pendingMessages
            const keepLength = Math.floor(historyText.length * keepRatio);
            if (keepLength > 0) {
              const trimmed = historyText.slice(-keepLength);
              const firstEntry = trimmed.indexOf('[ASSISTANT]');
              historyText = firstEntry > 0
                ? '...(context recovery — earlier history removed)\n' + trimmed.slice(firstEntry)
                : '...(context recovery — earlier history removed)\n' + trimmed;
            } else {
              historyText = '';
            }
            // Also truncate large tool results in pendingMessages
            const toolResultCap = contextRecoveryAttempts >= 2 ? 100 : 300;
            pendingMessages = pendingMessages.map(msg => {
              if (msg.role === 'tool' && msg.content && msg.content.length > toolResultCap) {
                return { ...msg, content: msg.content.slice(0, toolResultCap) + '...(truncated)' };
              }
              return msg;
            });
            // On 3rd attempt, clear pending entirely
            if (contextRecoveryAttempts >= 3) {
              pendingMessages = [];
            }
            logger.info(`SubAgent[${this.appName}] plan mode recovery: historyText=${historyText.length} chars, pending=${pendingMessages.length} msgs`);
          } else {
            // Simple mode: progressively more aggressive message removal
            const keepRecent = contextRecoveryAttempts === 1 ? 4 : contextRecoveryAttempts === 2 ? 2 : 0;
            const toolResultCap = contextRecoveryAttempts >= 2 ? 100 : 300;
            if (simpleMessages.length > 2 + keepRecent && keepRecent > 0) {
              let recent = simpleMessages.slice(-keepRecent);
              // Ensure message pair integrity:
              // 1. Strip leading orphaned tool messages (no preceding assistant with matching tool_calls)
              while (recent.length > 0 && recent[0]!.role === 'tool') {
                recent = recent.slice(1);
              }
              // 2. Strip trailing assistant messages with tool_calls (their tool responses were cut off)
              while (recent.length > 0) {
                const last = recent[recent.length - 1]!;
                if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
                  recent = recent.slice(0, -1);
                } else {
                  break;
                }
              }
              const preserved = [
                simpleMessages[0]!, // system
                simpleMessages[1]!, // initial user instruction
                ...recent,
              ];
              simpleMessages.length = 0;
              simpleMessages.push(...preserved);
            } else if (keepRecent === 0 && simpleMessages.length > 2) {
              // Most aggressive: keep only system + user
              simpleMessages.length = 2;
            }
            // Truncate tool results in remaining messages
            for (let i = 2; i < simpleMessages.length; i++) {
              const msg = simpleMessages[i]!;
              if (msg.role === 'tool' && msg.content && msg.content.length > toolResultCap) {
                simpleMessages[i] = { role: msg.role, content: msg.content.slice(0, toolResultCap) + '...(truncated)', tool_call_id: msg.tool_call_id };
              }
            }
            logger.info(`SubAgent[${this.appName}] simple mode recovery: ${simpleMessages.length} msgs, toolCap=${toolResultCap}`);
          }

          streamLog(this.appName, 'info', `Context recovery ${contextRecoveryAttempts} complete, retrying`);
          iterations--;
          continue;
        }

        // All recovery attempts exhausted or non-context error: graceful exit
        if (error instanceof ContextLengthError) {
          logger.error(`SubAgent[${this.appName}] context overflow unrecoverable after ${contextRecoveryAttempts} attempts`, {
            iteration: iterations,
            totalToolCalls,
          } as any);
          streamLog(this.appName, 'error', `Context recovery exhausted (${contextRecoveryAttempts} attempts), aborting`);
          return this.buildResult(
            true,
            `Sub-agent stopped due to context overflow after ${totalToolCalls} tool calls. Work saved before overflow is preserved.`,
            undefined,
            iterations,
            totalToolCalls,
            startTime
          );
        }

        // Non-context errors: rethrow
        throw error;
      }

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) {
        streamLog(this.appName, 'error', 'No response from Sub-LLM', { iteration: iterations });
        return this.buildResult(false, undefined, 'No response from Sub-LLM', iterations, totalToolCalls, startTime);
      }

      // No tool calls = text response
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const content = assistantMessage.content || '';
        // Empty content with no tool calls = LLM failed to produce output (e.g. thinking model with reasoning_content only)
        // Retry instead of returning empty
        if (!content.trim()) {
          logger.warn(`SubAgent[${this.appName}] received empty response with no tool calls, retrying (iteration ${iterations})`);
          streamLog(this.appName, 'debug', `Empty response, retrying (iteration ${iterations})`);
          if (plan) {
            historyText += this.flattenExchange(pendingMessages);
            pendingMessages = [];
          }
          continue;
        }
        logger.flow(`SubAgent[${this.appName}] completed with text response`);
        streamLog(this.appName, 'info', `Completed with text response (${content.length} chars)`, { response: content.slice(0, 500) });
        return this.buildResult(true, content, undefined, iterations, totalToolCalls, startTime);
      }

      // Process tool calls — collect results
      const toolResults: Message[] = [];

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        let args: Record<string, unknown>;

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          toolResults.push({
            role: 'tool',
            content: 'Error: Invalid JSON in tool arguments.',
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // Handle complete tool
        if (toolName === 'complete') {
          // Guard: reject premature completion if not enough work done
          if (this.minToolCallsBeforeComplete > 0 && totalToolCalls < this.minToolCallsBeforeComplete) {
            const remaining = this.minToolCallsBeforeComplete - totalToolCalls;
            logger.warn(`SubAgent[${this.appName}] rejected premature complete`, {
              totalToolCalls, minRequired: this.minToolCallsBeforeComplete,
            });
            toolResults.push({
              role: 'tool',
              content: `REJECTED: You have only executed ${totalToolCalls} tool calls, but the minimum is ${this.minToolCallsBeforeComplete}. You still have approximately ${remaining} more tool calls worth of work to do. Go back to your EXECUTION PLAN and continue building the remaining slides. Do NOT call "complete" again until ALL planned slides (including closing slide) are built and saved.`,
              tool_call_id: toolCall.id,
            });
            continue;
          }
          const summary = (args['summary'] as string) || 'Task completed.';
          logger.flow(`SubAgent[${this.appName}] completed via complete tool`);
          streamLog(this.appName, 'info', `Completed via complete tool (iter: ${iterations}, toolCalls: ${totalToolCalls})`, { summary: summary.slice(0, 500) });
          return this.buildResult(true, summary, undefined, iterations, totalToolCalls, startTime);
        }

        // Execute app tool
        const tool = this.toolMap.get(toolName);
        if (!tool) {
          toolResults.push({
            role: 'tool',
            content: `Error: Unknown tool "${toolName}". Use only the provided tools.`,
            tool_call_id: toolCall.id,
          });
          continue;
        }

        totalToolCalls++;
        const toolStartTime = Date.now();
        streamLog(this.appName, 'tool_start', `Tool #${totalToolCalls}: ${toolName}`, {
          tool: toolName,
          args: JSON.stringify(args).slice(0, 500),
          iteration: iterations,
        });

        try {
          const result = await tool.execute(args);
          const toolDuration = Date.now() - toolStartTime;
          const resultText = result.success
            ? result.result || '(success, no output)'
            : `Error: ${result.error || 'Unknown error'}`;

          // Always log tool calls for debugging (not just when globalToolCallLogger is set)
          logger.info(`[SubAgent:${this.appName}] Tool #${totalToolCalls} (iter ${iterations})`, {
            tool: toolName,
            args: JSON.stringify(args).slice(0, 500),
            result: resultText.slice(0, 1000),
            success: result.success,
            duration: toolDuration,
          });

          streamLog(this.appName, 'tool_end', `Tool #${totalToolCalls}: ${toolName} → ${result.success ? 'OK' : 'FAIL'} (${toolDuration}ms)`, {
            tool: toolName,
            success: result.success,
            duration: toolDuration,
            result: resultText.slice(0, 1000),
          });

          toolResults.push({
            role: 'tool',
            content: resultText,
            tool_call_id: toolCall.id,
          });

          if (globalToolCallLogger) {
            globalToolCallLogger(this.appName, toolName, args, resultText, result.success, iterations, totalToolCalls);
          }
        } catch (error) {
          const toolDuration = Date.now() - toolStartTime;
          const errorMsg = error instanceof Error ? error.message : String(error);

          logger.error(`[SubAgent:${this.appName}] Tool #${totalToolCalls} FAILED (iter ${iterations})`, {
            tool: toolName,
            args: JSON.stringify(args).slice(0, 500),
            error: errorMsg,
            duration: toolDuration,
          } as any);

          reportError(error, {
            type: 'subAgentToolExecution',
            agent: this.appName,
            tool: toolName,
            iteration: iterations,
            duration: toolDuration,
          }).catch(() => {});

          streamLog(this.appName, 'error', `Tool #${totalToolCalls}: ${toolName} EXCEPTION (${toolDuration}ms): ${errorMsg}`, {
            tool: toolName,
            error: errorMsg,
            duration: toolDuration,
          });

          toolResults.push({
            role: 'tool',
            content: `Error executing ${toolName}: ${errorMsg}`,
            tool_call_id: toolCall.id,
          });

          if (globalToolCallLogger) {
            globalToolCallLogger(this.appName, toolName, args, errorMsg, false, iterations, totalToolCalls);
          }
        }
      }

      // Update message state
      if (plan) {
        // Flatten previous exchange into history, keep current as proper messages
        historyText += this.flattenExchange(pendingMessages);
        pendingMessages = [assistantMessage, ...toolResults];

        // Plan mode context protection: cap historyText to prevent unbounded growth
        const HISTORY_MAX_CHARS = 50000;
        if (historyText.length > HISTORY_MAX_CHARS) {
          const trimmed = historyText.slice(-HISTORY_MAX_CHARS);
          const firstEntry = trimmed.indexOf('[ASSISTANT]');
          historyText = firstEntry > 0
            ? '...(earlier history omitted)\n' + trimmed.slice(firstEntry)
            : '...(earlier history omitted)\n' + trimmed;
          logger.info(`SubAgent[${this.appName}] compacted historyText to ${historyText.length} chars`);
        }
      } else {
        simpleMessages.push(assistantMessage, ...toolResults);

        // Simple mode context protection: compact old tool results to prevent unbounded growth
        if (simpleMessages.length > 10) {
          const keepRecentCount = 6; // Keep last ~3 exchanges intact
          const compactBoundary = simpleMessages.length - keepRecentCount;
          for (let i = 2; i < compactBoundary; i++) {
            const msg = simpleMessages[i]!;
            if (msg.role === 'tool' && msg.content && msg.content.length > 500) {
              simpleMessages[i] = { role: msg.role, content: msg.content.slice(0, 500) + '...(compacted)', tool_call_id: msg.tool_call_id };
            }
          }
        }
      }
    }

    // Max iterations exceeded
    logger.warn(`SubAgent[${this.appName}] max iterations reached`, { maxIterations: this.maxIterations });
    streamLog(this.appName, 'error', `Max iterations reached (${this.maxIterations}), forced completion`, { totalToolCalls });
    return this.buildResult(
      true,
      `Sub-agent completed after ${this.maxIterations} iterations. ${totalToolCalls} tool calls executed.`,
      undefined,
      iterations,
      totalToolCalls,
      startTime
    );
  }

  /**
   * Enhance instruction with topic-specific creative guidance via LLM.
   * Returns null on failure (graceful degradation — raw instruction used).
   */
  private async enhanceInstruction(instruction: string): Promise<string | null> {
    logger.info(`SubAgent[${this.appName}] enhancing instruction`);
    try {
      const response = await this.llmClient.chatCompletion({
        messages: [
          { role: 'system', content: this.enhancementPrompt! },
          { role: 'user', content: instruction },
        ],
        temperature: 0.5,
      });

      const enhancement = response.choices[0]?.message?.content;
      if (enhancement) {
        logger.info(`SubAgent[${this.appName}] instruction enhanced`, { length: enhancement.length });
      }
      return enhancement || null;
    } catch (error) {
      logger.warn(`SubAgent[${this.appName}] enhancement failed, proceeding without`, {
        error: error instanceof Error ? error.message : String(error),
      });
      reportError(error, { type: 'subAgentEnhancement', agent: this.appName }).catch(() => {});
      return null;
    }
  }

  /**
   * Generate a structured execution plan via single LLM call.
   * Returns null on failure (graceful degradation to simple mode).
   */
  private async generatePlan(instruction: string): Promise<string | null> {
    logger.info(`SubAgent[${this.appName}] generating plan`);
    try {
      const response = await this.llmClient.chatCompletion({
        messages: [
          { role: 'system', content: this.planningPrompt! },
          { role: 'user', content: instruction },
        ],
        temperature: 0.4,
      });

      const plan = response.choices[0]?.message?.content;
      if (plan) {
        logger.info(`SubAgent[${this.appName}] plan generated`, { length: plan.length });
      }
      return plan || null;
    } catch (error) {
      logger.warn(`SubAgent[${this.appName}] planning failed, proceeding without plan`, {
        error: error instanceof Error ? error.message : String(error),
      });
      reportError(error, { type: 'subAgentPlanning', agent: this.appName }).catch(() => {});
      return null;
    }
  }

  /**
   * Rebuild messages with plan context every iteration (main agent pattern).
   * Ensures plan + progress are always visible to LLM, even after 100+ tool calls.
   *
   * Structure: [system, user(plan+history+instruction), ...recentMessages]
   *   - plan: always at top — LLM always knows the full plan
   *   - history: flattened text of past exchanges — LLM knows what's done
   *   - instruction: original task — LLM knows the goal
   *   - recentMessages: last assistant+tool exchange as proper messages (API compliant)
   */
  private rebuildMessages(
    plan: string,
    instruction: string,
    historyText: string,
    recentMessages: Message[]
  ): Message[] {
    let userContent = `<EXECUTION_PLAN>\n${plan}\n</EXECUTION_PLAN>\n\n`;

    if (historyText) {
      userContent += `<PREVIOUS_WORK>\n${historyText}</PREVIOUS_WORK>\n\n`;
    }

    userContent += `<INSTRUCTION>\n${instruction}\n</INSTRUCTION>\n\n`;
    userContent += 'Follow the EXECUTION_PLAN step by step. Continue from where PREVIOUS_WORK left off.';
    if (this.executionRules) {
      userContent += '\n' + this.executionRules;
    }

    // Detect Korean in instruction and add language enforcement
    const hasKorean = /[\uac00-\ud7af\u1100-\u11ff]/.test(instruction);
    if (hasKorean) {
      userContent += '\n⚠ LANGUAGE:   .  (, ,  ,  )   .        .';
    }

    return [
      { role: 'system' as const, content: this.systemPrompt },
      { role: 'user' as const, content: userContent },
      ...recentMessages,
    ];
  }

  /**
   * Flatten messages (assistant + tool results) into text for history.
   * Truncates long tool results to save context window.
   */
  private flattenExchange(messages: Message[]): string {
    if (messages.length === 0) return '';

    const lines: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (msg.content) lines.push(`[ASSISTANT]: ${msg.content}`);
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            const args = tc.function.arguments;
            const truncatedArgs = args.length > 200 ? args.slice(0, 200) + '...' : args;
            lines.push(`[TOOL_CALL]: ${tc.function.name}(${truncatedArgs})`);
          }
        }
      } else if (msg.role === 'tool') {
        const content = msg.content || '';
        const truncated = content.length > 500
          ? content.slice(0, 500) + '...(truncated)'
          : content;
        lines.push(`[TOOL_RESULT]: ${truncated}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  private buildResult(
    success: boolean,
    result: string | undefined,
    error: string | undefined,
    iterations: number,
    toolCalls: number,
    startTime: number
  ): ToolResult {
    const duration = Date.now() - startTime;
    logger.exit(`SubAgent[${this.appName}].run`, { success, iterations, toolCalls, duration });
    return {
      success,
      result,
      error,
      metadata: { iterations, toolCalls, duration },
    };
  }
}
