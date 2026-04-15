/**
 * Excel Create Agent
 *
 * LLMAgentTool for creating NEW Excel spreadsheets using high-level sheet builders.
 * Uses SubAgent architecture with Enhancement → Planning → Execution loop.
 *
 * CLI parity: electron/main/agents/office/excel-create-agent.ts
 */

import { LLMAgentTool } from '../../tools/types.js';
import { EXCEL_CREATE_TOOLS } from '../../tools/office/excel-tools.js';
import { SubAgent } from '../common/sub-agent.js';
import {
  EXCEL_CREATE_SYSTEM_PROMPT,
  EXCEL_CREATE_PLANNING_PROMPT,
  EXCEL_CREATE_ENHANCEMENT_PROMPT,
} from './excel-create-prompts.js';

export function createExcelCreateRequestTool(): LLMAgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'excel_create_agent',
        description:
          'Autonomous Microsoft Excel CREATION agent for building NEW spreadsheets from scratch. Uses high-level sheet builders to produce professional-quality workbooks with styled headers, data tables, formulas, charts, and conditional formatting — all automatically. For editing EXISTING .xlsx files, use excel_modify_agent instead.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description:
                'Detailed instruction for spreadsheet creation. Include: data topic, column structure, any specific calculations or charts needed, and save path. The agent will autonomously create a professional spreadsheet.',
            },
          },
          required: ['instruction'],
        },
      },
    },
    execute: async (args, llmClient) => {
      const instruction = args['instruction'] as string;
      const isSmallSheet = /(?:\s*|1\s*|\s*|1\s*sheet)/i.test(instruction);
      const agent = new SubAgent(
        llmClient,
        'excel-create',
        EXCEL_CREATE_TOOLS,
        EXCEL_CREATE_SYSTEM_PROMPT,
        {
          maxIterations: isSmallSheet ? 20 : 45,
          planningPrompt: EXCEL_CREATE_PLANNING_PROMPT,
          enhancementPrompt: EXCEL_CREATE_ENHANCEMENT_PROMPT,
          minToolCallsBeforeComplete: isSmallSheet ? 5 : 12,
          executionRules: [
            'MANDATORY EXECUTION ORDER — follow EXACTLY for EACH sheet:',
            '',
            '  Step A: excel_build_data_sheet  (minimum 5 columns, minimum 8 data rows)',
            '  Step B: excel_build_formula_columns  (at least 1 calculated column)',
            '  Step C: excel_build_summary_row  (SUM/AVERAGE for numeric columns)',
            '  Step D: excel_build_conditional_format  ← FIRST RULE:',
            '          rule_type: "cellValue", operator: "lessThan", value1: "0", font_color: "#FF0000"',
            '          (apply to the growth/change column range, e.g. "D3:D14")',
            '  Step E: excel_build_conditional_format  ← SECOND RULE:',
            '          rule_type: "colorScale"',
            '          (apply to the main numeric column range, e.g. "B3:B14")',
            '  Step F: excel_build_chart  (data_range must cover actual data cells only)',
            '',
            'After completing A-F on Sheet 1 → excel_add_sheet → repeat A-F for Sheet 2.',
            '',
            'HARD RULES:',
            '- Steps D AND E are BOTH mandatory on EVERY sheet. excel_save WILL REJECT if missing.',
            '- NEVER use OFFSET(), INDIRECT(), or INDEX() in formulas.',
            '- NEVER call excel_save until BOTH sheets have ALL 6 steps complete.',
            '- Sheet 1 = detailed monthly/item data. Sheet 2 = summary/dashboard view.',
          ].join('\n'),
        },
      );
      return agent.run(args['instruction'] as string);
    },
    categories: ['llm-agent'],
    requiresSubLLM: true,
  };
}
