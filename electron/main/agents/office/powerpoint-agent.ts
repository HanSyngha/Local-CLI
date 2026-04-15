/**
 * PowerPoint Modify Agent
 *
 * LLMAgentTool for EDITING existing presentations using low-level tools.
 * For creating NEW presentations, use powerpoint-create-agent instead.
 *
 * Electron parity: src/agents/office/powerpoint-agent.ts
 */

import type { LLMAgentTool } from '../../tools/types';
import { POWERPOINT_TOOLS } from '../../tools/office/powerpoint-tools';
import { SubAgent } from '../common/sub-agent';
import { POWERPOINT_SYSTEM_PROMPT, POWERPOINT_PLANNING_PROMPT, POWERPOINT_ENHANCEMENT_PROMPT } from './prompts';

export function createPowerPointModifyRequestTool(): LLMAgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'powerpoint_modify_agent',
        description:
          'Autonomous PowerPoint MODIFY agent for editing EXISTING .pptx files. Opens an existing presentation and makes targeted changes: edit text, rearrange slides, modify formatting, add/remove content, update charts, etc. For creating NEW presentations from scratch, use powerpoint_create_agent instead.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description:
                'Detailed instruction for modifying an existing presentation. Include: file path to open, specific changes needed (text edits, slide modifications, formatting changes), and save path. The agent will open the file, make targeted edits, and save.',
            },
          },
          required: ['instruction'],
        },
      },
    },
    execute: async (args, llmClient) => {
      const agent = new SubAgent(
        llmClient,
        'powerpoint',
        POWERPOINT_TOOLS,
        POWERPOINT_SYSTEM_PROMPT,
        {
          maxIterations: 300,
          planningPrompt: POWERPOINT_PLANNING_PROMPT,
          enhancementPrompt: POWERPOINT_ENHANCEMENT_PROMPT,
          minToolCallsBeforeComplete: 80,
          executionRules: 'CRITICAL RULES:\n1. Build the EXACT layout type assigned in the plan. If the plan says "Layout: B", build two columns — NEVER substitute with Layout A.\n2. Layout A is MAX 3 slides total. After your 3rd Layout A, ALL remaining slides MUST be B/C/D/E/F.\n3. The LAST slide MUST be a CLOSING slide (""/"Thank You"). NEVER end with a content slide.\n4. Before calling powerpoint_save, verify: Is my last slide CLOSING? If not, build it NOW.',
        }
      );
      return agent.run(args['instruction'] as string);
    },
    categories: ['llm-agent'],
    requiresSubLLM: true,
  };
}
