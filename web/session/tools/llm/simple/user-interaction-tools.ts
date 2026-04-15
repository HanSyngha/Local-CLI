/**
 * User Interaction Tools (LLM Simple)
 *
 * LLM     
 * - tell_to_user:   
 * - ask_to_user:    
 */

import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { ToolDefinition } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

// ============================================
// tell_to_user Tool
// ============================================

/**
 * Callback for tell_to_user messages
 */
type TellToUserCallback = (message: string) => void;
let tellToUserCallback: TellToUserCallback | null = null;

/**
 * Set callback for tell_to_user messages
 */
export function setTellToUserCallback(callback: TellToUserCallback | null): void {
  tellToUserCallback = callback;
}

/**
 * tell_to_user Tool Definition
 */
const TELL_TO_USER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'tell_to_user',
    description: `Send a message directly to the user to explain what you're doing or provide status updates.
Use this tool to communicate with the user during task execution.
The message will be displayed immediately in the UI.`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: `A natural, conversational message for the user (in user's language).
Examples:
- "Analyzing the files, please wait a moment"
- "Found the config file! Let me modify it now"
- "Ran the tests and 2 failed. Let me find the cause"
- "Almost done, wrapping up the work"`,
        },
      },
      required: ['message'],
    },
  },
};

/**
 * Execute tell_to_user
 */
async function executeTellToUser(args: Record<string, unknown>): Promise<ToolResult> {
  const message = args['message'] as string;

  if (tellToUserCallback) {
    tellToUserCallback(message);
  }

  return {
    success: true,
    result: `Message sent to user: ${message}`,
  };
}

/**
 * tell_to_user LLM Simple Tool
 */
export const tellToUserTool: LLMSimpleTool = {
  definition: TELL_TO_USER_DEFINITION,
  execute: executeTellToUser,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Send message to user',
};

// ============================================
// ask_to_user Tool
// ============================================

/**
 *   
 */
export interface AskUserRequest {
  question: string;
  options: string[];
}

/**
 *  
 */
export interface AskUserResponse {
  selectedOption: string;
  isOther: boolean;
  customText?: string;
}

/**
 *    
 */
export type AskUserCallback = (request: AskUserRequest) => Promise<AskUserResponse>;

let askUserCallback: AskUserCallback | null = null;

/**
 * Set the ask-user callback
 */
export function setAskUserCallback(callback: AskUserCallback): void {
  logger.flow('Setting ask-user callback');
  askUserCallback = callback;
}

/**
 * Clear ask-user callback
 */
export function clearAskUserCallback(): void {
  logger.flow('Clearing ask-user callback');
  askUserCallback = null;
}

/**
 * Check if ask-user callback is available
 */
export function hasAskUserCallback(): boolean {
  return askUserCallback !== null;
}

/**
 * ask_to_user Tool Definition
 */
const ASK_TO_USER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_to_user',
    description: `Ask the user a question with multiple choice options.

Use this tool when you need to:
- Clarify ambiguous requirements
- Get user preferences or decisions
- Confirm important actions before proceeding
- Offer multiple implementation approaches

The user will always have an "Other (custom input)" option to provide custom input,
so you only need to provide the main choices.

RULES:
- Provide 2-4 clear, distinct options
- Each option should be a viable choice
- Keep the question concise and specific
- "Other" option is automatically added for custom input`,
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user. Should be clear and specific.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of main options for the user to choose from. Provide 2-4 options. An "Other" option for custom input is automatically added.',
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ['question', 'options'],
    },
  },
};

/**
 * Execute ask_to_user
 */
async function executeAskToUser(args: Record<string, unknown>): Promise<ToolResult> {
  logger.enter('executeAskToUser', args);

  const question = args['question'] as string;
  const options = args['options'] as string[];

  // Validate inputs
  if (!question || typeof question !== 'string') {
    logger.warn('Invalid question parameter');
    return {
      success: false,
      error: 'Invalid question: must be a non-empty string',
    };
  }

  if (!Array.isArray(options) || options.length < 2) {
    logger.warn('Invalid options parameter', { optionsLength: options?.length });
    return {
      success: false,
      error: 'Invalid options: must be an array with at least 2 items',
    };
  }

  if (options.length > 4) {
    logger.warn('Too many options', { optionsLength: options.length });
    return {
      success: false,
      error: 'Too many options: maximum 4 options allowed',
    };
  }

  if (!askUserCallback) {
    logger.warn('Ask-user callback not set');
    return {
      success: false,
      error: 'User interaction is not available in current context',
    };
  }

  try {
    logger.flow('Asking user question');
    const response = await askUserCallback({ question, options });

    logger.debug('User responded', { selectedOption: response.selectedOption, isOther: response.isOther });

    const resultText = response.isOther && response.customText
      ? `User provided custom response: "${response.customText}"`
      : `User selected: "${response.selectedOption}"`;

    logger.exit('executeAskToUser', { success: true });
    return {
      success: true,
      result: resultText,
      metadata: {
        question,
        selectedOption: response.selectedOption,
        isOther: response.isOther,
        customText: response.customText,
      },
    };
  } catch (error) {
    logger.errorSilent('Error asking user', error as Error);
    return {
      success: false,
      error: `Error asking user: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * ask_to_user LLM Simple Tool
 */
export const askToUserTool: LLMSimpleTool = {
  definition: ASK_TO_USER_DEFINITION,
  execute: executeAskToUser,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Ask user a question with options',
};

// ============================================
// Exports
// ============================================

/**
 * All user interaction tools
 */
export const USER_INTERACTION_TOOLS: LLMSimpleTool[] = [
  tellToUserTool,
  askToUserTool,
];

/**
 * USER_TOOLS alias for backward compatibility
 */
export const USER_TOOLS: LLMSimpleTool[] = USER_INTERACTION_TOOLS;

export default USER_INTERACTION_TOOLS;
