/**
 * Search Work Request Tool
 *
 * LLMAgentTool: Execution LLM tool ,  BrowserSubAgent .
 *   ( headless).
 * Supports additional research URLs from config (Confluence, internal wikis, etc.)
 */

import { LLMAgentTool } from '../../tools/types.js';
import { BROWSER_SUB_AGENT_TOOLS } from '../../tools/browser/browser-tools.js';
import { BrowserSubAgent } from './browser-sub-agent.js';
import { SEARCH_SYSTEM_PROMPT } from './prompts.js';
import { configManager } from '../../core/config/config-manager.js';
import { ResearchUrlConfig } from '../../types/index.js';

export function createSearchRequestTool(): LLMAgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'search_request',
        description:
          'Delegate a deep research task to the web search specialist agent. Performs comprehensive research across Google AND Naver simultaneously, visits actual source pages, cross-verifies facts, and returns a synthesized answer with citations. Also searches configured internal sources (Confluence, wikis, etc.) if available. Use for any question requiring up-to-date information, fact-checking, comparisons, or multi-source research.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'Natural language instruction describing what to research. Be specific about what information, facts, or data you need.',
            },
          },
          required: ['instruction'],
        },
      },
    },
    execute: async (args, llmClient) => {
      // Inject today's date for recency assessment
      const today = new Date().toISOString().split('T')[0];
      const rawInstruction = args['instruction'] as string;

      // Read research URLs from config
      let researchUrls: ResearchUrlConfig[] = [];
      try {
        const config = configManager.getConfig();
        researchUrls = config.researchUrls || [];
      } catch {
        // Config not loaded
      }

      // Build instruction with research URL context
      let instruction = `[Today's Date: ${today}]\n\n${rawInstruction}`;
      if (researchUrls.length > 0) {
        const urlList = researchUrls.map(r => `  - ${r.name}: ${r.url}`).join('\n');
        instruction += `\n\n[Internal Research Sources]\nSearch these additional sources after web search:\n${urlList}`;
      }

      // maxIterations: base 30 + 10 per research URL
      const maxIterations = 30 + researchUrls.length * 10;

      const agent = new BrowserSubAgent(
        llmClient,
        'search',
        BROWSER_SUB_AGENT_TOOLS,
        SEARCH_SYSTEM_PROMPT,
        { requiresAuth: false, serviceType: 'search', maxIterations }
      );
      return agent.run(instruction);
    },
    categories: ['llm-agent'],
    requiresSubLLM: true,
  };
}
