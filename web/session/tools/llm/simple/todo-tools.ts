/**
 * TODO Management LLM Tools
 *
 * LLM TODO     
 * Claude Code : write_todos   
 */

import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { ToolDefinition } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * TODO  (: title + status)
 */
export interface TodoInput {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/**
 * TODO    
 *    
 */
export type TodoWriteCallback = (todos: TodoInput[]) => Promise<boolean>;

// Global callback - set by orchestrator
let todoWriteCallback: TodoWriteCallback | null = null;

/**
 * Set the TODO write callback
 */
export function setTodoWriteCallback(callback: TodoWriteCallback): void {
  logger.flow('Setting TODO write callback');
  todoWriteCallback = callback;
}

/**
 * Clear TODO callbacks
 */
export function clearTodoCallbacks(): void {
  logger.flow('Clearing TODO callbacks');
  todoWriteCallback = null;
}

/**
 * write_todos Tool Definition
 *  TODO   (Claude Code )
 */
const WRITE_TODOS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_todos',
    description: `Replace the entire TODO list with a new list.

Use this to:
- Update TODO statuses (change status field)
- Add new TODOs (include in the array)
- Remove TODOs (omit from the array)
- Reorder TODOs (change array order)

IMPORTANT: You must include ALL TODOs you want to keep. Any TODO not in the array will be removed.

Example - Mark first task complete, second in progress:
{
  "todos": [
    { "id": "1", "title": "Setup project", "status": "completed" },
    { "id": "2", "title": "Implement feature", "status": "in_progress" },
    { "id": "3", "title": "Write tests", "status": "pending" }
  ]
}

Example - Add a new task:
{
  "todos": [
    { "id": "1", "title": "Existing task", "status": "completed" },
    { "id": "2", "title": "New task I just added", "status": "pending" }
  ]
}`,
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete TODO list (replaces existing list)',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique ID for the TODO',
              },
              title: {
                type: 'string',
                description: 'Short title describing the task',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'failed'],
                description: 'Current status of the TODO',
              },
            },
            required: ['id', 'title', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

/**
 * write_todos Tool Implementation
 */
async function executeWriteTodos(args: Record<string, unknown>): Promise<ToolResult> {
  logger.enter('executeWriteTodos', args);

  const todos = args['todos'] as TodoInput[];

  if (!todos || !Array.isArray(todos)) {
    logger.warn('Missing or invalid todos array');
    return {
      success: false,
      error: 'Missing required parameter: todos array is required',
    };
  }

  if (!todoWriteCallback) {
    logger.warn('TODO write callback not set');
    return {
      success: false,
      error: 'TODO management is not available in current context',
    };
  }

  // Validate each todo
  for (const todo of todos) {
    if (!todo.id || !todo.title || !todo.status) {
      return {
        success: false,
        error: `Invalid TODO item: each item must have id, title, and status`,
      };
    }
    if (!['pending', 'in_progress', 'completed', 'failed'].includes(todo.status)) {
      return {
        success: false,
        error: `Invalid status "${todo.status}" for TODO "${todo.id}"`,
      };
    }
  }

  try {
    logger.flow(`Writing ${todos.length} TODOs`);
    const success = await todoWriteCallback(todos);

    if (success) {
      const completed = todos.filter(t => t.status === 'completed').length;
      const inProgress = todos.filter(t => t.status === 'in_progress').length;
      const pending = todos.filter(t => t.status === 'pending').length;
      const failed = todos.filter(t => t.status === 'failed').length;

      const summary = `TODO list updated (${todos.length} items): ${completed} completed, ${inProgress} in progress, ${pending} pending, ${failed} failed`;

      logger.exit('executeWriteTodos', { success: true, count: todos.length });
      return {
        success: true,
        result: summary,
        metadata: { todoCount: todos.length, completed, inProgress, pending, failed },
      };
    } else {
      return {
        success: false,
        error: 'Failed to update TODO list',
      };
    }
  } catch (error) {
    logger.errorSilent('Error writing TODOs', error as Error);
    return {
      success: false,
      error: `Error writing TODOs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * LLM Simple Tool: write_todos
 */
export const WriteTodosTool: LLMSimpleTool = {
  definition: WRITE_TODOS_DEFINITION,
  execute: executeWriteTodos,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Write/replace entire TODO list',
};

/**
 * All TODO Tools
 */
export const TODO_TOOLS = [WriteTodosTool];

/**
 * Get TODO tool definitions for LLM
 */
export function getTodoToolDefinitions(): ToolDefinition[] {
  return TODO_TOOLS.map(tool => tool.definition);
}

export default TODO_TOOLS;
