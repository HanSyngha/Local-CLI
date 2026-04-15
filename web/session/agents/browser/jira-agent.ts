/**
 * Jira Request Tool
 *
 * LLMAgentTool: Visible browser Jira   task .
 *  //, ,  , JQL  .
 */

import { LLMAgentTool } from '../../tools/types.js';
import { BROWSER_SUB_AGENT_TOOLS } from '../../tools/browser/browser-tools.js';
import { BrowserSubAgent } from './browser-sub-agent.js';
import { JIRA_SYSTEM_PROMPT } from './prompts.js';

export function createJiraRequestTool(): LLMAgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'jira_request',
        description:
          'Delegate a task to the Jira specialist agent. Opens a visible browser to directly access Jira and perform operations. ' +
          'Capabilities: fetch assigned/watching issues via JQL, create issues (Epic, Story, Task, Bug, Sub-task) with user confirmation, ' +
          'add comments, view issue details, transition status, and general JQL search. ' +
          'Works with Jira Cloud, Server, and Data Center.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'Natural language instruction for the Jira task to perform',
            },
            source: {
              type: 'string',
              description: 'Jira URL to use (specify a particular instance when multiple URLs are configured)',
            },
          },
          required: ['instruction'],
        },
      },
    },
    execute: async (args, llmClient) => {
      const agent = new BrowserSubAgent(
        llmClient,
        'jira',
        BROWSER_SUB_AGENT_TOOLS,
        JIRA_SYSTEM_PROMPT,
        { requiresAuth: true, serviceType: 'jira', maxIterations: 30, headless: false }
      );
      return agent.run(args['instruction'] as string, args['source'] as string | undefined);
    },
    categories: ['llm-agent'],
    requiresSubLLM: true,
  };
}
