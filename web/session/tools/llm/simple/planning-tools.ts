/**
 * Planning Tools
 *
 * Planning LLM dedicated tools
 * - ask_to_user:   (   )
 * - create_todos: TODO   (action/implementation  )
 * - respond_to_user:   ( /)
 *
 * Planning LLM    tool    
 */

import { LLMSimpleTool, ToolResult } from '../../types.js';

/**
 * ask_to_user tool (Planning LLM)
 *      
 */
export const askToUserPlanningTool: LLMSimpleTool = {
  definition: {
    type: 'function',
    function: {
      name: 'ask_to_user',
      description: `Use this tool BEFORE creating TODOs when the user's request is ambiguous or unclear.

**WHEN TO USE:**
- The request is vague (e.g., "add authentication" - what type?)
- Multiple approaches are possible and user preference matters
- Missing critical information (e.g., deployment target, tech stack)
- You need to understand the user's environment or constraints

**HOW TO USE:**
- Ask specific, focused questions
- Provide 2-4 clear, distinct options
- You can call this tool MULTIPLE TIMES to gather all necessary info
- It's better to ask and do it right than to guess and do it wrong

**IMPORTANT:**
- An "Other (custom input)" option is automatically added
- Write questions in the user's language
- After getting answers, proceed with create_todos`,
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'A specific question to clarify the requirement (in user language)',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of 2-4 clear options for the user to choose from',
            minItems: 2,
            maxItems: 4,
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  // NOTE:  execute  PlanningLLM  tool_call   .
  //  ask_to_user  PlanningLLM user-interaction-tools callback .
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const question = args['question'] as string;
    const options = args['options'] as string[];
    return {
      success: true,
      result: JSON.stringify({ question, options }),
    };
  },
  categories: ['llm-planning'],
};

/**
 * create_todos tool
 * Planning  task TODO  
 */
export const createTodosTool: LLMSimpleTool = {
  definition: {
    type: 'function',
    function: {
      name: 'create_todos',
      description: `Use this tool for ANY task that requires ACTION - this is the PRIMARY tool for most requests.

When to use (almost everything!):
- Code work: implementation, bug fixes, refactoring, testing
- File operations: create, edit, organize, search files
- System tasks: run commands, install packages, build, deploy
- Document work: create/edit documents, spreadsheets, presentations
- Research tasks: search codebase, explore files, gather information
- Any task that requires the Execution Agent to DO something

DO NOT use ONLY for:
- Pure knowledge questions (e.g., "What is React?")
- Simple greetings (e.g., "Hello")

Guidelines:
- 1-5 TODOs (even 1 is fine for simple actions!)
- Actionable titles that clearly describe what to do
- Sequential order (execution order matters)
- Write titles in the user's language

When in doubt, USE THIS TOOL. The Execution Agent is powerful and can handle almost any task.`,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'A short title (5-20 chars, user language) summarizing ALL tasks as a whole. If user requests multiple things, combine them (e.g., "Schedule & budget docs"). This becomes the session name.',
          },
          todos: {
            type: 'array',
            description: 'List of TODO items',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique identifier (e.g., "1", "2", "3")',
                },
                title: {
                  type: 'string',
                  description: 'Clear, actionable task title (in user language)',
                },
              },
              required: ['id', 'title'],
            },
          },
          complexity: {
            type: 'string',
            enum: ['simple', 'moderate', 'complex'],
            description: 'Estimated complexity of the overall task',
          },
        },
        required: ['title', 'todos', 'complexity'],
      },
    },
  },
  // NOTE:  execute  PlanningLLM  tool_call   .
  //  tool definition   .
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const todos = args['todos'] as Array<{ id: string; title: string }>;
    const complexity = args['complexity'] as string;
    return {
      success: true,
      result: JSON.stringify({ todos, complexity }),
    };
  },
  categories: ['llm-planning'],
};

/**
 * respond_to_user tool
 *      
 */
export const respondToUserTool: LLMSimpleTool = {
  definition: {
    type: 'function',
    function: {
      name: 'respond_to_user',
      description: `Use this tool ONLY for pure knowledge questions or greetings - NO actions involved.

When to use (very limited!):
- Pure knowledge questions (e.g., "What is a React hook?", "Explain async/await")
- Simple greetings (e.g., "Hello", "How are you?")
- General concept explanations from your training data

DO NOT use for (use create_todos instead!):
- ANY task that involves files, code, or commands
- Codebase exploration or file searching (use create_todos!)
- Questions that require reading actual files to answer
- Bug fixes, implementation, refactoring, testing
- Running commands or builds
- Document creation or editing

⚠️ If the user asks about THEIR project/codebase, use create_todos - you need to actually read files!

Guidelines:
- Write response in the user's language
- Keep it concise`,
      parameters: {
        type: 'object',
        properties: {
          response: {
            type: 'string',
            description: 'Your direct response to the user (in their language)',
          },
        },
        required: ['response'],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const response = args['response'] as string;
    return {
      success: true,
      result: response,
    };
  },
  categories: ['llm-planning'],
};

/**
 * tell_to_user tool (Planning LLM)
 *     create_todos   
 * respond_to_user    
 */
export const tellToUserPlanningTool: LLMSimpleTool = {
  definition: {
    type: 'function',
    function: {
      name: 'tell_to_user',
      description: `Use this to send a message to the user and then CONTINUE planning with create_todos.

Unlike respond_to_user (which ENDS the conversation with no action), tell_to_user lets you:
- Acknowledge the user's request before creating TODOs
- Provide a brief explanation or context, then proceed to plan tasks
- Answer part of the question, then create TODOs for the action part

**IMPORTANT:** After calling tell_to_user, you MUST call create_todos next.
Do NOT use this instead of respond_to_user for pure knowledge questions.

Example flow:
1. tell_to_user: " .   ."
2. create_todos: [{"id": "1", "title": "   "}]`,
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to display to the user (in their language)',
          },
        },
        required: ['message'],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const message = args['message'] as string;
    return { success: true, result: message };
  },
  categories: ['llm-planning'],
};

/**
 * All Planning tools
 */
export const PLANNING_TOOLS: LLMSimpleTool[] = [
  askToUserPlanningTool,
  createTodosTool,
  respondToUserTool,
  tellToUserPlanningTool,
];
