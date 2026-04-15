/**
 * Final Response Tool
 *
 * LLM      
 * -  TODO  
 * -  TODO   return ( , LLM  )
 * -   assistant message 
 */

import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { ToolDefinition } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';
import { TodoItem } from '../../../types/index.js';

/**
 * TODO    
 */
export type GetTodosCallback = () => TodoItem[];

/**
 * Final response   
 * true return   
 */
export type FinalResponseCallback = (message: string) => void;

// Global callbacks - set by orchestrator
let getTodosCallback: GetTodosCallback | null = null;
let finalResponseCallback: FinalResponseCallback | null = null;

/**
 * Set the TODO getter callback
 */
export function setGetTodosCallback(callback: GetTodosCallback): void {
  logger.flow('Setting getTodos callback for final_response');
  getTodosCallback = callback;
}

/**
 * Set the final response callback
 */
export function setFinalResponseCallback(callback: FinalResponseCallback): void {
  logger.flow('Setting finalResponse callback');
  finalResponseCallback = callback;
}

/**
 * Clear callbacks
 */
export function clearFinalResponseCallbacks(): void {
  logger.flow('Clearing final response callbacks');
  getTodosCallback = null;
  finalResponseCallback = null;
}

/**
 * Check if all todos are completed
 */
function areAllTodosCompleted(todos: TodoItem[]): boolean {
  if (todos.length === 0) return true;
  return todos.every(t => t.status === 'completed' || t.status === 'failed');
}

/**
 * Get incomplete todos summary
 */
function getIncompleteTodosSummary(todos: TodoItem[]): string {
  const incomplete = todos.filter(t => t.status !== 'completed' && t.status !== 'failed');
  if (incomplete.length === 0) return '';

  const list = incomplete.map(t => `- [${t.status}] ${t.title}`).join('\n');
  return `Incomplete TODOs:\n${list}`;
}

/**
 * final_response Tool Definition
 */
const FINAL_RESPONSE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'final_response',
    description: `Use this tool to deliver your final response to the user after completing all tasks.

IMPORTANT:
- You MUST complete all TODOs before calling this tool
- If any TODO is not completed, this tool will return an error
- After all tasks are done, use this tool to summarize what was accomplished

Example:
{
  "message": "I've completed all the requested tasks:\\n\\n1. Fixed the bug in the login form\\n2. Added input validation\\n3. Updated the tests\\n\\nAll changes have been committed."
}`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Your final response message to the user. Summarize what was accomplished.',
        },
      },
      required: ['message'],
    },
  },
};

/**
 * final_response Tool Implementation
 */
async function executeFinalResponse(args: Record<string, unknown>): Promise<ToolResult> {
  logger.enter('executeFinalResponse', args);

  const message = args['message'] as string;

  if (!message || typeof message !== 'string') {
    logger.warn('Missing or invalid message');
    return {
      success: false,
      error: 'Missing required parameter: message is required',
    };
  }

  // Get current todos
  if (!getTodosCallback) {
    logger.warn('getTodos callback not set');
    // If no callback, allow final response (might be in a context without todos)
    if (finalResponseCallback) {
      finalResponseCallback(message);
    }
    return {
      success: true,
      result: message,
      metadata: { isFinalResponse: true },
    };
  }

  const todos = getTodosCallback();

  // Check if all todos are completed
  if (!areAllTodosCompleted(todos)) {
    const incompleteSummary = getIncompleteTodosSummary(todos);
    logger.flow('Final response rejected - incomplete TODOs');
    logger.debug('Incomplete TODOs', { count: todos.filter(t => t.status !== 'completed' && t.status !== 'failed').length });

    return {
      success: false,
      error: `Cannot deliver final response: Please complete all TODOs first.\n\n${incompleteSummary}\n\nMark each TODO as "completed" or "failed" using write_todos before calling final_response.`,
    };
  }

  // All todos completed - deliver final response
  logger.flow('All TODOs completed - delivering final response');

  if (finalResponseCallback) {
    finalResponseCallback(message);
  }

  return {
    success: true,
    result: message,
    metadata: { isFinalResponse: true },
  };
}

/**
 * LLM Simple Tool: final_response
 */
export const FinalResponseTool: LLMSimpleTool = {
  definition: FINAL_RESPONSE_DEFINITION,
  execute: executeFinalResponse,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Deliver final response to user (requires all TODOs completed)',
};

/**
 * Get final_response tool definition for LLM
 */
export function getFinalResponseToolDefinition(): ToolDefinition {
  return FINAL_RESPONSE_DEFINITION;
}

export default FinalResponseTool;
