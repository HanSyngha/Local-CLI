/**
 * Simple Tool Executor
 *
 * LLM Simple Tools    
 * file-tools.ts  
 */

import { ToolResult, isLLMSimpleTool, isLLMAgentTool } from '../../types.js';
import { getStreamLogger } from '../../../utils/json-stream-logger.js';
import type { LLMClient } from '../../../core/llm/llm-client.js';

/**
 * Callback for tool execution events (reason display to user)
 */
type ToolExecutionCallback = (toolName: string, reason: string, args: Record<string, unknown>) => void;
let toolExecutionCallback: ToolExecutionCallback | null = null;

/**
 * Callback for tool response events
 */
type ToolResponseCallback = (toolName: string, success: boolean, result: string) => void;
let toolResponseCallback: ToolResponseCallback | null = null;

/**
 * Callback for plan created events
 */
type PlanCreatedCallback = (todoTitles: string[]) => void;
let planCreatedCallback: PlanCreatedCallback | null = null;

/**
 * Callback for todo start events
 */
type TodoStartCallback = (title: string) => void;
let todoStartCallback: TodoStartCallback | null = null;

/**
 * Callback for todo complete events
 */
type TodoCompleteCallback = (title: string) => void;
let todoCompleteCallback: TodoCompleteCallback | null = null;

/**
 * Callback for todo fail events
 */
type TodoFailCallback = (title: string) => void;
let todoFailCallback: TodoFailCallback | null = null;

/**
 * Callback for tool approval (Supervised Mode)
 * Returns: 'approve' | 'always' | { reject: true; comment: string }
 */
export type ToolApprovalResult = 'approve' | 'always' | { reject: true; comment: string };
type ToolApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
  reason?: string
) => Promise<ToolApprovalResult>;
let toolApprovalCallback: ToolApprovalCallback | null = null;

/**
 * Callback for compact events
 */
type CompactCallback = (originalCount: number, newCount: number) => void;
let compactCallback: CompactCallback | null = null;

/**
 * Callback for assistant response events (final LLM response)
 */
type AssistantResponseCallback = (content: string) => void;
let assistantResponseCallback: AssistantResponseCallback | null = null;

/**
 * Callback for reasoning/thinking events (extended thinking from o1 models)
 */
type ReasoningCallback = (content: string, isStreaming: boolean) => void;
let reasoningCallback: ReasoningCallback | null = null;

/**
 * Callback for background auto-sync notifications
 * Fires when note/report/task is auto-saved after TODO completion
 */
type AutoSyncNotificationCallback = (result: import('../../../core/background-sync.js').AutoSyncResult) => void;
let autoSyncNotificationCallback: AutoSyncNotificationCallback | null = null;

// ============================================
// Callback Setters
// ============================================

export function setToolExecutionCallback(callback: ToolExecutionCallback | null): void {
  toolExecutionCallback = callback;
}

export function setToolResponseCallback(callback: ToolResponseCallback | null): void {
  toolResponseCallback = callback;
}

export function setPlanCreatedCallback(callback: PlanCreatedCallback | null): void {
  planCreatedCallback = callback;
}

export function setTodoStartCallback(callback: TodoStartCallback | null): void {
  todoStartCallback = callback;
}

export function setTodoCompleteCallback(callback: TodoCompleteCallback | null): void {
  todoCompleteCallback = callback;
}

export function setTodoFailCallback(callback: TodoFailCallback | null): void {
  todoFailCallback = callback;
}

export function setToolApprovalCallback(callback: ToolApprovalCallback | null): void {
  toolApprovalCallback = callback;
}

export function setCompactCallback(callback: CompactCallback | null): void {
  compactCallback = callback;
}

export function setAssistantResponseCallback(callback: AssistantResponseCallback | null): void {
  assistantResponseCallback = callback;
}

export function setReasoningCallback(callback: ReasoningCallback | null): void {
  reasoningCallback = callback;
}

export function setAutoSyncNotificationCallback(callback: AutoSyncNotificationCallback | null): void {
  autoSyncNotificationCallback = callback;
}

// ============================================
// Callback Getters & Emitters
// ============================================

export function getToolExecutionCallback(): ToolExecutionCallback | null {
  return toolExecutionCallback;
}

export async function requestToolApproval(
  toolName: string,
  args: Record<string, unknown>,
  reason?: string
): Promise<ToolApprovalResult | null> {
  if (!toolApprovalCallback) {
    return null;
  }
  return toolApprovalCallback(toolName, args, reason);
}

export function emitPlanCreated(todoTitles: string[]): void {
  if (planCreatedCallback) {
    planCreatedCallback(todoTitles);
  }
}

export function emitTodoStart(title: string): void {
  if (todoStartCallback) {
    todoStartCallback(title);
  }
}

export function emitTodoComplete(title: string): void {
  if (todoCompleteCallback) {
    todoCompleteCallback(title);
  }
}

export function emitTodoFail(title: string): void {
  if (todoFailCallback) {
    todoFailCallback(title);
  }
}

export function emitAutoSyncNotification(result: import('../../../core/background-sync.js').AutoSyncResult): void {
  if (autoSyncNotificationCallback) {
    autoSyncNotificationCallback(result);
  }
}

export function emitCompact(originalCount: number, newCount: number): void {
  if (compactCallback) {
    compactCallback(originalCount, newCount);
  }
}

export function emitAssistantResponse(content: string): void {
  // Skip empty content to prevent blank lines in UI
  if (assistantResponseCallback && content && content.trim()) {
    // Filter out <think>...</think> tags (used by some models like DeepSeek)
    // Extract thinking content and emit as reasoning, then remove from main content
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let thinkingContent = '';
    let match;
    while ((match = thinkRegex.exec(content)) !== null) {
      if (match[1] && match[1].trim()) {
        thinkingContent += match[1].trim() + '\n';
      }
    }

    // Emit thinking as reasoning if present
    if (thinkingContent && reasoningCallback) {
      reasoningCallback(thinkingContent.trim(), false);
    }

    // Remove <think> tags from content
    const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (cleanedContent) {
      assistantResponseCallback(cleanedContent);

      // Log assistant response (for Ctrl+O LogBrowser chat category)
      const streamLogger = getStreamLogger();
      streamLogger?.logAssistantResponse(cleanedContent);
    }
  }
}

export function emitReasoning(content: string, isStreaming: boolean = false): void {
  // Skip empty content to prevent blank lines in UI
  if (reasoningCallback && content && content.trim()) {
    reasoningCallback(content, isStreaming);
  }
}

// ============================================
// Tool Executor
// ============================================

/**
 * Execute a simple tool by name
 * Uses tool registry to find and execute tools
 */
export async function executeSimpleTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const startTime = Date.now();
  const logger = getStreamLogger();

  // Dynamic import to avoid circular dependency
  const { toolRegistry } = await import('../../registry.js');
  const tool = toolRegistry.get(toolName);

  if (!tool || !isLLMSimpleTool(tool)) {
    const error = `Unknown or not a simple tool: ${toolName}`;
    // Log tool execution failure
    logger?.logToolEnd(toolName, false, undefined, error, Date.now() - startTime);
    return {
      success: false,
      error,
    };
  }

  // Extract reason from args (not required for TODO tools)
  const reason = args['reason'] as string | undefined;

  // Log tool execution start
  logger?.logToolStart(toolName, args, reason);

  // Call the callback to notify UI about tool execution (pass all args)
  // Skip for TODO tools which don't have reason parameter
  const isTodo = ['update_todos', 'get_todo_list', 'write_todos'].includes(toolName);
  if (toolExecutionCallback && !isTodo) {
    toolExecutionCallback(toolName, reason || toolName, args);
  }

  // Execute the tool
  const result = await tool.execute(args);
  const durationMs = Date.now() - startTime;

  // Log tool execution end
  logger?.logToolEnd(
    toolName,
    result.success,
    result.success ? result.result : undefined,
    result.success ? undefined : result.error,
    durationMs
  );

  // Call the response callback to notify UI about tool result
  // Skip response callback for TODO tools to avoid cluttering UI
  const isTodoTool = ['update_todos', 'get_todo_list'].includes(toolName);
  if (toolResponseCallback && !isTodoTool) {
    const resultText = result.success
      ? (result.result || '')
      : (result.error || 'Unknown error');
    toolResponseCallback(toolName, result.success, resultText);
  }

  return result;
}

/**
 * @deprecated Use executeSimpleTool instead
 */
export const executeFileTool = executeSimpleTool;

/**
 * Execute an agent tool by name (LLMAgentTool).
 * Agent tools require a Sub-LLM client to run their internal iteration loop.
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  llmClient: LLMClient
): Promise<ToolResult> {
  const startTime = Date.now();
  const logger = getStreamLogger();

  const { toolRegistry } = await import('../../registry.js');
  const tool = toolRegistry.get(toolName);

  if (!tool || !isLLMAgentTool(tool)) {
    const error = `Unknown or not an agent tool: ${toolName}`;
    logger?.logToolEnd(toolName, false, undefined, error, Date.now() - startTime);
    return { success: false, error };
  }

  const reason = (args['instruction'] as string) || toolName;

  logger?.logToolStart(toolName, args, reason);

  if (toolExecutionCallback) {
    toolExecutionCallback(toolName, reason, args);
  }

  const result = await tool.execute(args, llmClient);
  const durationMs = Date.now() - startTime;

  logger?.logToolEnd(
    toolName,
    result.success,
    result.success ? result.result : undefined,
    result.success ? undefined : result.error,
    durationMs
  );

  if (toolResponseCallback) {
    const resultText = result.success ? (result.result || '') : (result.error || 'Unknown error');
    toolResponseCallback(toolName, result.success, resultText);
  }

  return result;
}
