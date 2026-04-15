/**
 * Excel Tools - Barrel Export
 *  Excel   export
 */

// Sheet builders (high-level, for Create Agent)
export * from './sheet-builders.js';

// Domain imports
export * from './launch.js';
export * from './cells.js';
export * from './formatting.js';
export * from './sheets.js';
export * from './rows-columns.js';
export * from './data-ops.js';
export * from './charts.js';
export * from './validation.js';
export * from './named-ranges.js';
export * from './comments.js';
export * from './protection.js';
export * from './media.js';
export * from './export.js';
export * from './pivot-table.js';
export * from './formulas.js';
export * from './tables.js';
export * from './page-setup.js';
export * from './advanced.js';

// Import tool arrays for aggregation
import { launchTools } from './launch.js';
import { cellsTools } from './cells.js';
import { formattingTools } from './formatting.js';
import { sheetsTools } from './sheets.js';
import { rowsColumnsTools } from './rows-columns.js';
import { dataOpsTools } from './data-ops.js';
import { chartsTools } from './charts.js';
import { validationTools } from './validation.js';
import { namedRangesTools } from './named-ranges.js';
import { commentsTools } from './comments.js';
import { protectionTools } from './protection.js';
import { mediaTools } from './media.js';
import { exportTools } from './export.js';
import { pivotTableTools } from './pivot-table.js';
import { formulasTools } from './formulas.js';
import { tablesTools } from './tables.js';
import { pageSetupTools } from './page-setup.js';
import { advancedTools } from './advanced.js';

import { sheetBuilderTools, excelValidatedSaveTool } from './sheet-builders.js';
import { excelCreateTool, excelScreenshotTool } from './launch.js';
import { excelAddSheetTool, excelRenameSheetTool } from './sheets.js';

import type { LLMSimpleTool } from '../../types.js';

/**
 *  Excel  
 */
export const EXCEL_TOOLS: LLMSimpleTool[] = [
  ...launchTools,
  ...cellsTools,
  ...formattingTools,
  ...sheetsTools,
  ...rowsColumnsTools,
  ...dataOpsTools,
  ...chartsTools,
  ...validationTools,
  ...namedRangesTools,
  ...commentsTools,
  ...protectionTools,
  ...mediaTools,
  ...exportTools,
  ...pivotTableTools,
  ...formulasTools,
  ...tablesTools,
  ...pageSetupTools,
  ...advancedTools,
];

/**
 * Excel CREATE tools — high-level sheet builders + lifecycle tools
 * Used by the Excel Create Agent
 */
export const EXCEL_CREATE_TOOLS: LLMSimpleTool[] = [
  excelCreateTool,
  excelValidatedSaveTool,  // Validated save: checks sheets, charts, CF before saving
  excelScreenshotTool,
  excelAddSheetTool,
  excelRenameSheetTool,
  ...sheetBuilderTools,
];
