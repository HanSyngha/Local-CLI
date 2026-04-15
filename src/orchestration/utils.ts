/**
 * Orchestration Utilities
 *
 * Plan & Execute   
 */

import { TodoItem, Message } from '../types/index.js';
import { BaseError } from '../errors/base.js';
import { logger } from '../utils/logger.js';

/**
 *    
 */
export function formatErrorMessage(error: unknown): string {
  logger.enter('formatErrorMessage');

  if (error instanceof BaseError) {
    let message = `❌ ${error.getUserMessage()}\n`;
    message += `\n📋 Error Code: ${error.code}`;

    if (error.details && Object.keys(error.details).length > 0) {
      message += `\n\n🔍 Details:`;
      for (const [key, value] of Object.entries(error.details)) {
        if (key === 'fullError') continue;
        if (typeof value === 'object') {
          message += `\n  • ${key}: ${JSON.stringify(value, null, 2)}`;
        } else {
          message += `\n  • ${key}: ${value}`;
        }
      }
    }

    if (error.isRecoverable) {
      message += `\n\n💡    .  .`;
    }

    message += `\n\n🕐 : ${error.timestamp.toLocaleString('ko-KR')}`;
    logger.exit('formatErrorMessage', { isBaseError: true });
    return message;
  }

  if (error instanceof Error) {
    // Only show error message, hide stack trace from user
    const message = `❌ Error: ${error.message}`;
    logger.exit('formatErrorMessage', { isError: true });
    return message;
  }

  logger.exit('formatErrorMessage', { isUnknown: true });
  return `❌ Unknown Error: ${String(error)}`;
}

/**
 *     flatten
 * multi-turn     XML   
 * system  , tool /   (truncate )
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
 * TODO  LLM 
 *     LLM  
 */
export function buildTodoContext(todos: TodoItem[]): string {
  if (todos.length === 0) return '';

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
 *  TODO  
 *    
 */
export function areAllTodosCompleted(todos: TodoItem[]): boolean {
  return todos.every(t => t.status === 'completed' || t.status === 'failed');
}

/**
 *    TODO 
 */
export function findActiveTodo(todos: TodoItem[]): TodoItem | undefined {
  return todos.find(t => t.status === 'in_progress') || todos.find(t => t.status === 'pending');
}

/**
 * TODO  
 */
export function getTodoStats(todos: TodoItem[]): {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
} {
  return {
    total: todos.length,
    completed: todos.filter(t => t.status === 'completed').length,
    failed: todos.filter(t => t.status === 'failed').length,
    pending: todos.filter(t => t.status === 'pending').length,
    inProgress: todos.filter(t => t.status === 'in_progress').length,
  };
}
