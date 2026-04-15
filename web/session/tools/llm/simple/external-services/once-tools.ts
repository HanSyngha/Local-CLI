/**
 * ONCE Tools (Execution Loop)
 *
 * ONCE — AI  /  
 *
 * 1 tool available in the execution loop:
 * - once_search (AI )
 *
 * once_note_add background-sync  
 *
 * CLI parity: electron/main/tools/llm/simple/external-services/once-tools.ts
 */

import { ToolDefinition } from '../../../../types/index.js';
import { LLMSimpleTool, ToolResult, ToolCategory } from '../../../types.js';
import { onceSearch } from './external-service-api-clients.js';
import { logger } from '../../../../utils/logger.js';

// =============================================================================
// 1. once_search — ONCE AI Search
// =============================================================================

const ONCE_SEARCH_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'once_search',
    description: `ONCE — AI-powered search of the user's personal notes, meeting records, and saved knowledge.

Purpose: Notes are saved specifically so they can be referenced when similar issues arise again.
When you encounter an error or get stuck, ALWAYS search first — the user may have already solved this before.

Proactively use this tool to help the user:
- When something isn't working → search for prior troubleshooting records and solutions
- When you encounter an error → check if the user has documented a fix before
- When you need context from the user's previous work or meeting records
- When looking for information the user may have saved before

Note: This search is synchronous and may take up to 2 minutes as the AI explores folders. Results are ranked by relevance.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Natural explanation for the user about what you are searching for',
        },
        query: {
          type: 'string',
          description: 'Search query in natural language',
        },
      },
      required: ['reason', 'query'],
    },
  },
};

const onceSearchTool: LLMSimpleTool = {
  definition: ONCE_SEARCH_DEFINITION,
  categories: ['llm-simple'] as ToolCategory[],

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args['query'] as string;
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'query is required and must be a string' };
    }

    logger.debug('once_search execute', { query });
    const result = await onceSearch(query);

    if (result.success) {
      return { success: true, result: result.result };
    }
    return { success: false, error: result.error };
  },
};

// =============================================================================
// Export
// =============================================================================

/**
 * ONCE tools available in execution loop.
 * once_note_add background-sync  .
 */
export const ONCE_TOOLS: LLMSimpleTool[] = [
  onceSearchTool,
];
