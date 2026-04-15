/**
 * Excel Sheet Builder Tools
 *
 * High-level tools that create complete sheet structures in 1 tool call.
 * Each builder handles cell formatting, colors, formulas, and layout internally.
 * Used by the Excel Creation Agent for new spreadsheets.
 *
 * CLI parity: electron/main/tools/office/excel-tools/sheet-builders.ts
 */

import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult } from '../../types.js';
import { excelClient } from '../excel-client.js';
import { OFFICE_CATEGORIES } from '../common/constants.js';

// =============================================================================
// Types & Presets
// =============================================================================

interface ColorConfig {
  primary: string;    // Title row, emphasis
  accent: string;     // Header row background
  body: string;       // Body text color
  light: string;      // Alternate row fill
  headerText: string; // Header text color
}

interface FontConfig {
  title: string;
  body: string;
}

const COLOR_PRESETS: Record<string, ColorConfig> = {
  MODERN_GREEN: { primary: '#0D1B2A', accent: '#1B998B', body: '#333333', light: '#E0F7F5', headerText: '#FFFFFF' },
  WARM_AMBER: { primary: '#2C1810', accent: '#C45B28', body: '#333333', light: '#FFF3EC', headerText: '#FFFFFF' },
  MINIMAL_SLATE: { primary: '#1A1A2E', accent: '#374151', body: '#444444', light: '#F5F5F5', headerText: '#FFFFFF' },
  CORPORATE_BLUE: { primary: '#1B3A5C', accent: '#2E5090', body: '#333333', light: '#EBF0F7', headerText: '#FFFFFF' },
  VIBRANT_CORAL: { primary: '#1A1A2E', accent: '#E63946', body: '#333333', light: '#FFF0F0', headerText: '#FFFFFF' },
  DEEP_PURPLE: { primary: '#1A1A2E', accent: '#6C3483', body: '#333333', light: '#F3E8FF', headerText: '#FFFFFF' },
};

const FONT_PRESETS: Record<string, FontConfig> = {
  MODERN_GREEN: { title: 'Segoe UI', body: ' ' },
  WARM_AMBER: { title: 'Georgia', body: ' ' },
  MINIMAL_SLATE: { title: ' ', body: '' },
  CORPORATE_BLUE: { title: 'Calibri', body: ' ' },
  VIBRANT_CORAL: { title: 'Arial', body: ' ' },
  DEEP_PURPLE: { title: 'Segoe UI', body: ' ' },
};

const DEFAULT_FONTS: FontConfig = { title: 'Segoe UI', body: ' ' };

/** Check if a hex color is too light (luminance > threshold) */
function isColorTooLight(hex: string, threshold = 180): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  // Perceived luminance (ITU-R BT.709)
  return (0.299 * r + 0.587 * g + 0.114 * b) > threshold;
}

function resolveColors(args: Record<string, unknown>): ColorConfig {
  let colors: ColorConfig;
  if (args['colors'] && typeof args['colors'] === 'object') {
    const c = args['colors'] as Record<string, string>;
    colors = {
      primary: c['primary'] || '#1A1A2E',
      accent: c['accent'] || '#1B998B',
      body: c['body'] || '#333333',
      light: c['light'] || '#F5F5F5',
      headerText: c['headerText'] || '#FFFFFF',
    };
  } else {
    const scheme = (args['color_scheme'] as string) || 'MODERN_GREEN';
    colors = COLOR_PRESETS[scheme] ?? COLOR_PRESETS['MODERN_GREEN']!;
  }
  // Safety: body text must be dark enough to read on white/light backgrounds
  if (isColorTooLight(colors.body)) {
    colors.body = '#333333';
  }
  return colors;
}

function resolveFonts(args: Record<string, unknown>): FontConfig {
  if (args['fonts'] && typeof args['fonts'] === 'object') {
    const f = args['fonts'] as Record<string, string>;
    return { title: f['title'] || 'Segoe UI', body: f['body'] || ' ' };
  }
  if (typeof args['fonts'] === 'string') {
    return FONT_PRESETS[args['fonts']] ?? DEFAULT_FONTS;
  }
  const scheme = (args['color_scheme'] as string) || 'MODERN_GREEN';
  return FONT_PRESETS[scheme] ?? DEFAULT_FONTS;
}

/** Convert column index (0-based) to Excel letter */
function colLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// Common color/font parameter definitions
const COLOR_FONT_PARAMS = {
  color_scheme: { type: 'string' as const, description: 'Preset: MODERN_GREEN, WARM_AMBER, MINIMAL_SLATE, CORPORATE_BLUE, VIBRANT_CORAL, DEEP_PURPLE' },
  colors: { type: 'object' as const, properties: { primary: { type: 'string' as const }, accent: { type: 'string' as const }, body: { type: 'string' as const }, light: { type: 'string' as const }, headerText: { type: 'string' as const } } },
  fonts: { type: 'object' as const, properties: { title: { type: 'string' as const }, body: { type: 'string' as const } } },
};

// =============================================================================
// Tool 1: Data Sheet
// =============================================================================

const EXCEL_BUILD_DATA_SHEET_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_build_data_sheet',
    description: 'Build a complete data sheet with title row, styled headers, data rows, number formatting, and autofit. One call = one finished data sheet.',
    parameters: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string', description: 'Sheet name (will rename the active sheet)' },
        title: { type: 'string', description: 'Title text for the merged title row' },
        headers: { type: 'array', items: { type: 'string' }, description: 'Column header names' },
        data: {
          type: 'array',
          description: '2D array of data rows. Each row is an array of cell values.',
          items: { type: 'array', items: { type: 'string' } },
        },
        number_formats: {
          type: 'object',
          description: 'Column-letter to format mapping, e.g., {"C": "#,##0", "D": "0.0%"}',
        },
        column_widths: {
          type: 'object',
          description: 'Column-letter to width mapping, e.g., {"A": 15, "B": 30}. Omitted columns get autofit.',
        },
        ...COLOR_FONT_PARAMS,
      },
      required: ['sheet_name', 'title', 'headers', 'data'],
    },
  },
};

async function executeBuildDataSheet(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const sheetName = (args['sheet_name'] as string) || 'Sheet1';
    const title = (args['title'] as string) || '';
    const headers = (args['headers'] as string[]) || [];
    const data = (args['data'] as string[][]) || [];
    const numberFormats = (args['number_formats'] as Record<string, string>) || {};
    const columnWidths = (args['column_widths'] as Record<string, number>) || {};

    if (headers.length === 0) {
      return { success: false, error: 'Headers array cannot be empty' };
    }

    const colCount = headers.length;
    const lastCol = colLetter(colCount - 1);

    // Rename sheet
    try {
      await excelClient.excelRenameSheet('Sheet1', sheetName);
    } catch {
      // Sheet may already have a different name
    }

    // Row 1: Title (merged across all columns)
    await excelClient.excelWriteCell('A1', title, sheetName, { fontName: fonts.title, fontSize: 16, bold: true });
    if (colCount > 1) {
      await excelClient.excelMergeCells(`A1:${lastCol}1`, sheetName);
    }
    await excelClient.excelSetFill(`A1:${lastCol}1`, colors.primary, sheetName);
    await excelClient.excelSetFont(`A1:${lastCol}1`, { color: '#FFFFFF', bold: true, fontSize: 16 }, sheetName);
    await excelClient.excelSetAlignment('A1', { horizontal: 'center', vertical: 'center' }, sheetName);
    await excelClient.excelSetRowHeight(1, 40, false, sheetName);

    // Row 2: Headers
    const headerRow = headers.map(h => h);
    await excelClient.excelWriteRange('A2', [headerRow], sheetName);
    await excelClient.excelSetFill(`A2:${lastCol}2`, colors.accent, sheetName);
    await excelClient.excelSetFont(`A2:${lastCol}2`, { color: colors.headerText, bold: true, fontSize: 11, fontName: fonts.body }, sheetName);
    await excelClient.excelSetAlignment(`A2:${lastCol}2`, { horizontal: 'center', vertical: 'center' }, sheetName);
    await excelClient.excelSetRowHeight(2, 30, false, sheetName);
    await excelClient.excelSetBorder(`A2:${lastCol}2`, { style: 'thin', color: '#FFFFFF' }, sheetName);

    // Data rows (starting from row 3)
    if (data.length > 0) {
      await excelClient.excelWriteRange('A3', data, sheetName);

      const lastRow = 2 + data.length;
      const dataRange = `A3:${lastCol}${lastRow}`;

      // Font for data
      await excelClient.excelSetFont(dataRange, { fontName: fonts.body, fontSize: 10, color: colors.body }, sheetName);

      // Alternate row coloring
      for (let i = 0; i < data.length; i++) {
        const row = 3 + i;
        if (i % 2 === 1) {
          await excelClient.excelSetFill(`A${row}:${lastCol}${row}`, colors.light, sheetName);
        }
      }

      // Thin borders for data area
      await excelClient.excelSetBorder(dataRange, { style: 'thin', color: '#D0D0D0' }, sheetName);

      // Number formats
      for (const [col, format] of Object.entries(numberFormats)) {
        const range = `${col}3:${col}${lastRow}`;
        await excelClient.excelSetNumberFormat(range, format, sheetName);
      }
    }

    // Column widths (explicit or autofit)
    for (let i = 0; i < colCount; i++) {
      const col = colLetter(i);
      if (columnWidths[col]) {
        await excelClient.excelSetColumnWidth(col, columnWidths[col], false, sheetName);
      } else {
        await excelClient.excelSetColumnWidth(col, undefined, true, sheetName);
      }
    }

    return { success: true, result: `Data sheet "${sheetName}" built (${headers.length} cols, ${data.length} rows)` };
  } catch (error) {
    return { success: false, error: `Failed to build data sheet: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 2: Formula Columns
// =============================================================================

const EXCEL_BUILD_FORMULA_COLUMNS_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_build_formula_columns',
    description: 'Add formula columns to an existing data sheet. Each formula specifies the column, header, and formula template using {row} placeholder. Use {row-1} for previous row references. Wrap in IFERROR for edge cases: "=IFERROR((B{row}-B{row-1})/B{row-1},0)"',
    parameters: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string', description: 'Target sheet name' },
        header_row: { type: 'number', description: 'Row number of headers (default: 2)' },
        data_start_row: { type: 'number', description: 'First data row (default: 3)' },
        data_end_row: { type: 'number', description: 'Last data row' },
        formulas: {
          type: 'array',
          description: 'Formula definitions. Use {row} as row placeholder in formula_template.',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: 'Target column letter (e.g., "F")' },
              header: { type: 'string', description: 'Column header text' },
              formula_template: { type: 'string', description: 'Excel formula with {row} placeholder. Use {row-1} for previous row. Examples: "=C{row}-D{row}", "=IFERROR((B{row}-B{row-1})/B{row-1},0)", "=SUM($B$3:B{row})"' },
              number_format: { type: 'string', description: 'Number format for the column, e.g., "#,##0", "0.0%"' },
            },
            required: ['column', 'header', 'formula_template'],
          },
        },
        ...COLOR_FONT_PARAMS,
      },
      required: ['sheet_name', 'data_end_row', 'formulas'],
    },
  },
};

async function executeBuildFormulaColumns(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const sheetName = (args['sheet_name'] as string) || 'Sheet1';
    const headerRow = (args['header_row'] as number) || 2;
    const dataStartRow = (args['data_start_row'] as number) || 3;
    const dataEndRow = (args['data_end_row'] as number) || 10;
    const formulas = (args['formulas'] as Array<Record<string, string>>) || [];

    for (const f of formulas) {
      const col = f['column'] || 'F';
      const header = f['header'] || '';
      const template = f['formula_template'] || '';
      const numFormat = f['number_format'] || '';

      // Write header
      await excelClient.excelWriteCell(`${col}${headerRow}`, header, sheetName, { fontName: fonts.body, bold: true });
      await excelClient.excelSetFill(`${col}${headerRow}`, colors.accent, sheetName);
      await excelClient.excelSetFont(`${col}${headerRow}`, { color: colors.headerText, bold: true }, sheetName);

      // Write formulas for each row — resolve {row}, {row-N}, {row+N} placeholders
      for (let row = dataStartRow; row <= dataEndRow; row++) {
        const formula = template
          .replace(/\{row([+-]\d+)\}/g, (_m, offset) => String(row + parseInt(offset, 10)))
          .replace(/\{row\}/g, String(row));
        await excelClient.excelSetFormula(`${col}${row}`, formula, sheetName);
      }

      // Number format
      if (numFormat) {
        await excelClient.excelSetNumberFormat(`${col}${dataStartRow}:${col}${dataEndRow}`, numFormat, sheetName);
      }

      // Autofit
      await excelClient.excelSetColumnWidth(col, undefined, true, sheetName);
    }

    return { success: true, result: `${formulas.length} formula column(s) added to "${sheetName}"` };
  } catch (error) {
    return { success: false, error: `Failed to add formula columns: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 3: Summary Row
// =============================================================================

const EXCEL_BUILD_SUMMARY_ROW_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_build_summary_row',
    description: 'Add a styled summary/total row at the bottom of data. Automatically applies SUM, AVERAGE, or other formulas.',
    parameters: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string', description: 'Target sheet name' },
        label: { type: 'string', description: 'Label text (e.g., "", "Total")' },
        label_column: { type: 'string', description: 'Column for the label (default: "A")' },
        target_row: { type: 'number', description: 'Row number for summary' },
        formulas: {
          type: 'array',
          description: 'Summary formulas for specific columns',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: 'Column letter' },
              formula: { type: 'string', description: 'Full formula, e.g., "=SUM(C3:C12)"' },
              number_format: { type: 'string', description: 'Number format' },
            },
            required: ['column', 'formula'],
          },
        },
        last_data_column: { type: 'string', description: 'Last column letter for styling range' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['sheet_name', 'label', 'target_row', 'formulas'],
    },
  },
};

async function executeBuildSummaryRow(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const sheetName = (args['sheet_name'] as string) || 'Sheet1';
    const label = (args['label'] as string) || '';
    const labelCol = (args['label_column'] as string) || 'A';
    const targetRow = (args['target_row'] as number) || 10;
    const formulas = (args['formulas'] as Array<Record<string, string>>) || [];
    const lastCol = (args['last_data_column'] as string) || 'F';

    // Label
    await excelClient.excelWriteCell(`${labelCol}${targetRow}`, label, sheetName, {
      fontName: fonts.title, fontSize: 11, bold: true,
    });

    // Formulas
    for (const f of formulas) {
      const col = f['column'] || 'B';
      const formula = f['formula'] || '';
      const numFormat = f['number_format'] || '';

      await excelClient.excelSetFormula(`${col}${targetRow}`, formula, sheetName);
      if (numFormat) {
        await excelClient.excelSetNumberFormat(`${col}${targetRow}`, numFormat, sheetName);
      }
    }

    // Style the summary row
    const range = `${labelCol}${targetRow}:${lastCol}${targetRow}`;
    await excelClient.excelSetFill(range, colors.primary, sheetName);
    await excelClient.excelSetFont(range, { color: '#FFFFFF', bold: true, fontSize: 11, fontName: fonts.body }, sheetName);
    await excelClient.excelSetBorder(range, { style: 'thin', color: colors.primary }, sheetName);
    await excelClient.excelSetRowHeight(targetRow, 30, false, sheetName);

    return { success: true, result: `Summary row added at row ${targetRow} in "${sheetName}"` };
  } catch (error) {
    return { success: false, error: `Failed to add summary row: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 4: Chart
// =============================================================================

const EXCEL_BUILD_CHART_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_build_chart',
    description: 'Add a styled chart to the sheet. Supports column, bar, line, pie, area, scatter, doughnut types. MUST provide category_range for axis labels.',
    parameters: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string', description: 'Target sheet name' },
        chart_type: { type: 'string', enum: ['column', 'bar', 'line', 'pie', 'area', 'scatter', 'doughnut'], description: 'Chart type' },
        data_range: { type: 'string', description: 'NUMERIC data only (no text/date columns). E.g., "B2:D12" for columns B-D with header row.' },
        category_range: { type: 'string', description: 'REQUIRED. Range of text labels for X-axis/pie slices. E.g., "A3:A12" for category names. Without this, chart shows 1,2,3... instead of labels.' },
        title: { type: 'string', description: 'Chart title' },
        position: {
          type: 'object',
          description: 'Chart position and size',
          properties: {
            left: { type: 'number', description: 'Left position in points' },
            top: { type: 'number', description: 'Top position in points' },
            width: { type: 'number', description: 'Width in points (default: 500)' },
            height: { type: 'number', description: 'Height in points (default: 300)' },
          },
        },
      },
      required: ['sheet_name', 'chart_type', 'data_range', 'category_range', 'title'],
    },
  },
};

async function executeBuildChart(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const sheetName = (args['sheet_name'] as string) || 'Sheet1';
    const chartType = (args['chart_type'] as 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut') || 'column';
    const dataRange = (args['data_range'] as string) || 'A2:D12';
    const categoryRange = (args['category_range'] as string) || '';
    const title = (args['title'] as string) || '';
    const pos = (args['position'] as Record<string, number>) || {};

    // Auto-calculate safe chart top position using actual COM position data
    const userTop = pos['top'] || 0;
    const userLeft = pos['left'] || 20;
    let chartTop = userTop;
    if (userLeft < 350) {
      // Chart overlaps data columns — query actual used range bottom from COM
      const usedBottom = await excelClient.getUsedRangeBottom(sheetName);
      const gapPoints = 50; // 50pt gap below data
      chartTop = Math.max(userTop, usedBottom + gapPoints);
    }

    await excelClient.excelAddChart(dataRange, chartType, {
      title,
      left: pos['left'] || 20,
      top: chartTop,
      width: pos['width'] || 500,
      height: pos['height'] || 300,
      sheet: sheetName,
      categoryRange: categoryRange || undefined,
    });

    return { success: true, result: `Chart "${title}" (${chartType}) added to "${sheetName}"` };
  } catch (error) {
    return { success: false, error: `Failed to add chart: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 5: Conditional Format
// =============================================================================

const EXCEL_BUILD_CONDITIONAL_FORMAT_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_build_conditional_format',
    description: 'Apply conditional formatting to a range. Supports cell value rules, color scales, data bars, icon sets, duplicate highlighting, and top/bottom 10.',
    parameters: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string', description: 'Target sheet name' },
        range: { type: 'string', description: 'Cell range, e.g., "C3:C12"' },
        rule_type: {
          type: 'string',
          enum: ['cellValue', 'colorScale', 'dataBar', 'iconSet', 'duplicates', 'top10'],
          description: 'Formatting rule type',
        },
        operator: { type: 'string', description: 'For cellValue: greaterThan, lessThan, between, equal, etc.' },
        value1: { type: 'string', description: 'Primary comparison value' },
        value2: { type: 'string', description: 'Secondary value (for "between")' },
        fill_color: { type: 'string', description: 'Fill color hex for matching cells' },
        font_color: { type: 'string', description: 'Font color hex for matching cells' },
      },
      required: ['sheet_name', 'range', 'rule_type'],
    },
  },
};

async function executeBuildConditionalFormat(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const sheetName = (args['sheet_name'] as string) || 'Sheet1';
    const range = (args['range'] as string) || 'A1';
    const ruleType = (args['rule_type'] as 'cellValue' | 'colorScale' | 'dataBar' | 'iconSet' | 'duplicates' | 'top10') || 'colorScale';

    await excelClient.excelAddConditionalFormat(range, ruleType, {
      operator: args['operator'] as 'greater' | 'less' | 'equal' | 'between' | 'notBetween' | undefined,
      value1: args['value1'] as string,
      value2: args['value2'] as string,
      fillColor: args['fill_color'] as string,
      fontColor: args['font_color'] as string,
      sheet: sheetName,
    });

    return { success: true, result: `Conditional format (${ruleType}) applied to ${range} in "${sheetName}"` };
  } catch (error) {
    return { success: false, error: `Failed to apply conditional format: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Export all sheet builder tools
// =============================================================================

export const excelBuildDataSheetTool: LLMSimpleTool = {
  definition: EXCEL_BUILD_DATA_SHEET_DEF,
  execute: executeBuildDataSheet,
  categories: OFFICE_CATEGORIES,
  description: 'Build complete data sheet',
};

export const excelBuildFormulaColumnsTool: LLMSimpleTool = {
  definition: EXCEL_BUILD_FORMULA_COLUMNS_DEF,
  execute: executeBuildFormulaColumns,
  categories: OFFICE_CATEGORIES,
  description: 'Add formula columns',
};

export const excelBuildSummaryRowTool: LLMSimpleTool = {
  definition: EXCEL_BUILD_SUMMARY_ROW_DEF,
  execute: executeBuildSummaryRow,
  categories: OFFICE_CATEGORIES,
  description: 'Add summary/total row',
};

export const excelBuildChartTool: LLMSimpleTool = {
  definition: EXCEL_BUILD_CHART_DEF,
  execute: executeBuildChart,
  categories: OFFICE_CATEGORIES,
  description: 'Add styled chart',
};

export const excelBuildConditionalFormatTool: LLMSimpleTool = {
  definition: EXCEL_BUILD_CONDITIONAL_FORMAT_DEF,
  execute: executeBuildConditionalFormat,
  categories: OFFICE_CATEGORIES,
  description: 'Apply conditional formatting',
};

// =============================================================================
// Tool 6: Validated Save (Create Agent only)
// =============================================================================

const EXCEL_VALIDATED_SAVE_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excel_save',
    description: 'Save the workbook. Validates quality requirements first: at least 2 sheets, each with charts and conditional formatting. If validation fails, returns what is missing instead of saving.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Explanation of why you are saving' },
        path: { type: 'string', description: 'File path to save to' },
      },
      required: ['reason'],
    },
  },
};

async function executeValidatedSave(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Pre-save quality check
    const validation = await excelClient.validateWorkbook();
    if (!validation.valid && validation.issues.length > 0) {
      return {
        success: false,
        error: `SAVE BLOCKED — Quality requirements not met:\n${validation.issues.map(i => `• ${i}`).join('\n')}\nFix these issues, then call excel_save again.`,
      };
    }

    // Validation passed — save
    const response = await excelClient.excelSave(args['path'] as string | undefined);
    if (response.success) {
      return { success: true, result: `Workbook saved: ${response['path'] || 'current location'}` };
    }
    return { success: false, error: response.error || 'Failed to save workbook' };
  } catch (error) {
    return { success: false, error: `Failed to save workbook: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const excelValidatedSaveTool: LLMSimpleTool = {
  definition: EXCEL_VALIDATED_SAVE_DEF,
  execute: executeValidatedSave,
  categories: OFFICE_CATEGORIES,
  description: 'Save Excel workbook with quality validation',
};

export const sheetBuilderTools: LLMSimpleTool[] = [
  excelBuildDataSheetTool,
  excelBuildFormulaColumnsTool,
  excelBuildSummaryRowTool,
  excelBuildChartTool,
  excelBuildConditionalFormatTool,
];
