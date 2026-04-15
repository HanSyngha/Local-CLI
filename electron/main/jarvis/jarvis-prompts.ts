/**
 * Jarvis Mode - Manager LLM Prompts
 *
 * Manager LLM ''    ,
 * Planner/Executor    .
 */

import type { JarvisMemoryEntry } from './jarvis-types';

// =============================================================================
// Manager LLM System Prompt
// =============================================================================

export const JARVIS_SYSTEM_PROMPT = `You are Jarvis, the user's autonomous personal assistant.

## Your Role
You are a MANAGER. You do NOT write code, create files, or execute commands directly.
You delegate work to the Planner/Executor system and manage the results.

## Your Tools

[Execution]
- delegate_to_planner: Send a detailed task description to the Planner. The Planner will create TODOs, and the Executor will use tools (file operations, shell commands, browser, etc.) to complete the task. This is BLOCKING — you wait for the full result.
  - Be as specific and detailed as possible in the task description.
  - Include context, file paths, expected outcomes.

[User Communication — 3 types, choose appropriately]
- report_to_user: Report to the user (greetings, status updates, completion notices). NON-BLOCKING — you continue immediately.
- request_approval: Ask the user for approval before proceeding. BLOCKING — you wait for OK/Cancel.
- ask_to_user: Ask the user a question. BLOCKING — you wait for their answer.

[Memory Management]
- add_memory: Add a new entry to persistent memory.
- update_memory: Update an existing memory entry by ID.
- delete_memory: Remove an outdated/incorrect memory entry by ID.

## Rules
1. You MUST use a tool every turn. Responses without tool calls are errors.
2. If there are many tasks, prioritize by: deadline urgency → feasibility → importance.
3. Be autonomous. Don't ask the user unnecessary questions. Decide and act.
4. After completing a task, ALWAYS review your memory and add/update/delete as needed.
5. When greeting the user, be warm and concise. Mention what you plan to work on today.
6. If the sub-LLM (Planner/Executor) asks you a question, try to answer from your memory and context first. Only escalate to the user via ask_to_user if you truly cannot answer.
7. Communicate in Korean () when talking to the user.
8. When delegating tasks, write instructions in Korean for clarity.
9. **Always provide tangible, user-visible deliverables — never just say "done".** If files were created, include the file path or open them directly. If information was retrieved, summarize the key content as text. If there are links, include them. A report the user cannot visually verify is not a report.`;

// =============================================================================
// Manager LLM Tool Definitions
// =============================================================================

export const JARVIS_MANAGER_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'delegate_to_planner',
      description: 'Planner/Executor task .   . Blocking —   .',
      parameters: {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description: ' task . ,  ,   .',
          },
          working_directory: {
            type: 'string',
            description: 'task   ().   .',
          },
        },
        required: ['task_description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'report_to_user',
      description: '  (, ,  ).  —     .',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '   ()',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_approval',
      description: '  . Blocking — OK/Cancel  .',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '   ().    .',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ask_to_user',
      description: ' . Blocking —  .',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '  ()',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '  ().    .',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_memory',
      description: '    .',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: ' / (: "kickoff_doc_completed", "user_prefers_markdown")',
          },
          content: {
            type: 'string',
            description: ' ',
          },
        },
        required: ['key', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_memory',
      description: '   .',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '  ID',
          },
          content: {
            type: 'string',
            description: ' ',
          },
        },
        required: ['id', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_memory',
      description: '    .',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '  ID',
          },
        },
        required: ['id'],
      },
    },
  },
];

// =============================================================================
// Context Builder
// =============================================================================

/**
 * Manager LLM  user prompt 
 */
export function buildManagerUserPrompt(params: {
  trigger: 'poll' | 'user_message' | 'greeting';
  userMessage?: string;
  memory: JarvisMemoryEntry[];
  recentConversation: string;
  currentTime: string;
  pendingMessages?: string[];
}): string {
  const parts: string[] = [];

  // 1. Jarvis Memory (Layer 1)
  if (params.memory.length > 0) {
    parts.push('<JARVIS_MEMORY>');
    for (const entry of params.memory) {
      parts.push(`[${entry.id}] ${entry.key}: ${entry.content} (updated: ${entry.updatedAt})`);
    }
    parts.push('</JARVIS_MEMORY>');
    parts.push('');
  }

  // 2. Current Data
  parts.push('<CURRENT_DATA>');
  parts.push(` : ${params.currentTime}`);
  parts.push('</CURRENT_DATA>');
  parts.push('');

  // 3. Recent Conversation (Layer 2)
  if (params.recentConversation) {
    parts.push('<RECENT_CONVERSATION>');
    parts.push(params.recentConversation);
    parts.push('</RECENT_CONVERSATION>');
    parts.push('');
  }

  // 4. Pending messages (     )
  if (params.pendingMessages && params.pendingMessages.length > 0) {
    parts.push('<PENDING_USER_MESSAGES>');
    for (const msg of params.pendingMessages) {
      parts.push(`- ${msg}`);
    }
    parts.push('</PENDING_USER_MESSAGES>');
    parts.push('');
  }

  // 5. Trigger context
  if (params.trigger === 'greeting') {
    parts.push('The app just started. Greet the user with: "!  24    AI .  !" then check today\'s tasks.');
  } else if (params.trigger === 'poll') {
    parts.push('  .     ,  task  .');
  } else if (params.trigger === 'user_message' && params.userMessage) {
    parts.push(` : "${params.userMessage}"`);
  }

  return parts.join('\n');
}
