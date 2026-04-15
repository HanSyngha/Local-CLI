/**
 * Excel Tools - Barrel Export
 *  Excel   export
 */

// Sheet builders (high-level, for Create Agent)
export * from './sheet-builders';

// Domain imports
export * from './launch';
export * from './cells';
export * from './formatting';
export * from './sheets';
export * from './rows-columns';
export * from './data-ops';
export * from './charts';
export * from './validation';
export * from './named-ranges';
export * from './comments';
export * from './protection';
export * from './media';
export * from './export';
export * from './pivot-table';
export * from './formulas';
export * from './tables';
export * from './page-setup';
export * from './advanced';

// Import tool arrays for aggregation
import { launchTools } from './launch';
import { cellsTools } from './cells';
import { formattingTools } from './formatting';
import { sheetsTools } from './sheets';
import { rowsColumnsTools } from './rows-columns';
import { dataOpsTools } from './data-ops';
import { chartsTools } from './charts';
import { validationTools } from './validation';
import { namedRangesTools } from './named-ranges';
import { commentsTools } from './comments';
import { protectionTools } from './protection';
import { mediaTools } from './media';
import { exportTools } from './export';
import { pivotTableTools } from './pivot-table';
import { formulasTools } from './formulas';
import { tablesTools } from './tables';
import { pageSetupTools } from './page-setup';
import { advancedTools } from './advanced';

import { sheetBuilderTools, excelValidatedSaveTool } from './sheet-builders';
import { excelCreateTool, excelScreenshotTool } from './launch';
import { excelAddSheetTool, excelRenameSheetTool } from './sheets';

import type { LLMSimpleTool } from '../../types';

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
