/**
 * Orchestration Utilities
 *
 * Helper functions for plan execution
 */

import type { Message } from '../core/llm';
import type { TodoItem } from './types';

// =============================================================================
// Message Utilities
// =============================================================================

/**
 * Validate tool messages - ensure tool results have matching assistant tool_calls
 */
export function validateToolMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  const pendingToolCallIds = new Set<string>();

  for (const msg of messages) {
    // Track tool_calls from assistant messages
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        pendingToolCallIds.add(toolCall.id);
      }
      result.push(msg);
      continue;
    }

    // Check tool messages have valid tool_call_id
    if (msg.role === 'tool') {
      if (!msg.tool_call_id || !pendingToolCallIds.has(msg.tool_call_id)) {
        // Skip orphan tool messages
        continue;
      }
      pendingToolCallIds.delete(msg.tool_call_id);
      result.push(msg);
      continue;
    }

    // Pass through other messages
    result.push(msg);
  }

  return result;
}

/**
 * Truncate messages to fit within limit
 */
export function truncateMessages(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  // Keep system message and recent messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const otherMessages = messages.filter((m) => m.role !== 'system');

  const keepCount = maxMessages - systemMessages.length;
  const truncated = otherMessages.slice(-keepCount);

  return [...systemMessages, ...truncated];
}

/**
 * Estimate token count for messages
 */
export function estimateTokenCount(messages: Message[]): number {
  const CHARS_PER_TOKEN = 4;
  let totalChars = 0;

  for (const msg of messages) {
    totalChars += msg.content?.length || 0;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        totalChars += tc.function.name.length;
        totalChars += tc.function.arguments.length;
      }
    }
  }

  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

// =============================================================================
// TODO Utilities
// =============================================================================

/**
 * Flatten messages to chronological history text
 * Converts multi-turn messages into single text for XML tag structure
 * CLI parity: src/orchestration/utils.ts
 */
export function flattenMessagesToHistory(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      lines.push(`[USER]: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      if (msg.content) {
        lines.push(`[ASSISTANT]: ${msg.content}`);
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          lines.push(`[TOOL_CALL]: ${tc.function.name}(${tc.function.arguments})`);
        }
      }
    } else if (msg.role === 'tool') {
      lines.push(`[TOOL_RESULT]: ${msg.content}`);
    } else if (msg.role === 'error') {
      lines.push(`[ERROR]: ${msg.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build TODO context string to inject into user message
 * CLI parity: src/orchestration/utils.ts
 */
export function buildTodoContext(todos: TodoItem[]): string {
  if (!todos || todos.length === 0) return '';

  const completedCount = todos.filter(t => t.status === 'completed').length;
  const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
  const pendingCount = todos.filter(t => t.status === 'pending').length;

  const todoList = todos.map((todo, idx) => {
    const statusIcon = todo.status === 'completed' ? '✅' :
                       todo.status === 'in_progress' ? '🔄' :
                       todo.status === 'failed' ? '❌' : '⏳';
    return `${idx + 1}. ${statusIcon} [${todo.status.toUpperCase()}] ${todo.title}`;
  }).join('\n');

  return `
---
## 📋 Current TODO List (${completedCount}/${todos.length} completed)

${todoList}

${pendingCount > 0 || inProgressCount > 0
  ? `**⚠️ CRITICAL: You MUST use write_todos tool to update TODO status.**
- When starting a task: call write_todos with status "in_progress"
- When completing a task: call write_todos with status "completed"
- Do NOT skip calling write_todos - execution will stall without it.
- After finishing current in_progress task, immediately mark it completed and start next pending task.`
  : '**All TODOs are completed! Provide a brief summary of what was accomplished.**'}
---`;
}

/**
 * Check if all TODOs are completed or failed
 */
export function areTodosComplete(todos: TodoItem[]): boolean {
  if (!todos || todos.length === 0) {
    return false;
  }
  return todos.every((t) => t.status === 'completed' || t.status === 'failed');
}

/**
 * Get next pending TODO
 */
export function getNextPendingTodo(todos: TodoItem[]): TodoItem | undefined {
  return todos.find((t) => t.status === 'pending');
}

/**
 * Mark TODO as in_progress
 */
export function markTodoInProgress(todos: TodoItem[], todoId: string): TodoItem[] {
  return todos.map((t) =>
    t.id === todoId
      ? { ...t, status: 'in_progress' as const }
      : t
  );
}

/**
 * Mark TODO as completed
 */
export function markTodoCompleted(todos: TodoItem[], todoId: string): TodoItem[] {
  return todos.map((t) =>
    t.id === todoId
      ? { ...t, status: 'completed' as const }
      : t
  );
}

/**
 * Mark TODO as failed
 */
export function markTodoFailed(todos: TodoItem[], todoId: string, error?: string): TodoItem[] {
  return todos.map((t) =>
    t.id === todoId
      ? { ...t, status: 'failed' as const, error: error || t.error }
      : t
  );
}

// =============================================================================
// Parse Tool Arguments
// =============================================================================

/**
 * Sanitize reason field to remove XML artifacts from malformed LLM responses
 * Some LLMs mix XML parameter syntax into JSON argument values
 *
 * Example malformed:
 *   "reason": " .\"\n<parameter name=\"alignment\">left"
 * Should become:
 *   "reason": " ."
 */
function sanitizeReason(reason: unknown): string {
  if (typeof reason !== 'string') {
    return String(reason || '');
  }

  let sanitized = reason;

  // Remove XML parameter tags: <parameter name="...">...</parameter> or <parameter name="...">
  sanitized = sanitized.replace(/<parameter\s+name\s*=\s*["'][^"']*["']>[^<]*/gi, '');
  sanitized = sanitized.replace(/<\/parameter>/gi, '');

  // Remove xAI function call tags
  sanitized = sanitized.replace(/<xai:function_call[^>]*>[\s\S]*?<\/xai:function_call>/gi, '');
  sanitized = sanitized.replace(/<xai:function_call[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/xai:function_call>/gi, '');

  // Remove other common XML tool call artifacts
  sanitized = sanitized.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  sanitized = sanitized.replace(/<arg_key>[^<]*<\/arg_key>/gi, '');
  sanitized = sanitized.replace(/<arg_value>[^<]*<\/arg_value>/gi, '');

  // Clean up trailing escaped quotes and newlines from truncated XML
  sanitized = sanitized.replace(/\\"\s*$/, '');
  sanitized = sanitized.replace(/\s*\\n\s*$/, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Parse tool arguments from JSON string
 * Also sanitizes the 'reason' field to remove XML artifacts
 */
export function parseToolArguments(argsString: string): Record<string, unknown> {
  if (!argsString || argsString.trim() === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(argsString);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Arguments must be an object');
    }

    // Sanitize reason field if present (removes XML artifacts from malformed LLM responses)
    if ('reason' in parsed && parsed.reason) {
      parsed.reason = sanitizeReason(parsed.reason);
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse tool arguments: ${error instanceof Error ? error.message : 'Invalid JSON'}`
    );
  }
}
