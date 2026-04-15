/**
 * Background Auto-Sync
 *
 * No-op for local-web: no ONCE/FREE/Dashboard services to sync with.
 * Function signatures preserved for plan-executor.ts compatibility.
 *
 * CLI parity: electron/main/core/background-sync.ts
 */

import type { LLMClient } from './llm/llm-client.js';
import type { TodoItem, Message } from '../types/index.js';

// =============================================================================
// Types
// =============================================================================

export interface AutoSyncResult {
  noteSaved?: { success: boolean; summary: string };
  workItemsAdded?: { success: boolean; count: number };
  workItemsUpdated?: { success: boolean; count: number };
  freeTodoCreated?: { success: boolean; count: number };
  freeTodoCompleted?: { success: boolean; count: number };
  loginRequired?: boolean;
  setupRequired?: { once?: boolean; free?: boolean };
}

export type AutoSyncNotifyCallback = (result: AutoSyncResult) => void;

// =============================================================================
// Compact History Builder (token-efficient)
// =============================================================================

/**
 *      ( )
 * tool_calls +,   
 */
export function buildCompactHistory(messages: Message[], maxMessages = 8): string {
  const recent = messages.slice(-maxMessages);
  const lines: string[] = [];

  for (const msg of recent) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      lines.push(`[USER]: ${msg.content.slice(0, 500)}`);
    } else if (msg.role === 'assistant') {
      if (msg.content) {
        lines.push(`[ASSISTANT]: ${msg.content.slice(0, 300)}`);
      }
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          lines.push(`[TOOL]: ${tc.function.name}`);
        }
      }
    } else if (msg.role === 'tool') {
      const summary = msg.content.length > 200
        ? msg.content.slice(0, 200) + '...'
        : msg.content;
      lines.push(`[RESULT]: ${summary}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Core: Background Auto-Sync Handler (no-op)
// =============================================================================

/**
 * TODO    //task  .
 * No-op for local-web.
 */
export async function handleTodoCompleteAutoSync(_params: {
  todoTitle: string;
  todoId: string;
  allTodos: TodoItem[];
  historyContext: string;
  userMessage: string;
  llmClient: LLMClient;
  toolsAlreadyCalled?: string[];
  notifyCallback: AutoSyncNotifyCallback;
}): Promise<void> {
  // No-op: local-web has no ONCE/FREE/Dashboard services
}

/**
 * AutoSyncResult    
 */
export function formatAutoSyncMessage(_result: AutoSyncResult): string {
  // No-op: local-web has no ONCE/FREE/Dashboard services
  return '';
}
