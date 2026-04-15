/**
 * Excel Client
 *
 * Microsoft Excel automation via PowerShell COM.
 * Extends OfficeClientBase with Excel-specific operations.
 */

import { OfficeClientBase, OfficeResponse, ScreenshotResponse } from './office-client-base';

/**
 * Convert column letter (A, B, ..., Z, AA, AB, ...) to number (1, 2, ..., 26, 27, 28, ...)
 */
function columnLetterToNumber(column: string): number {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * Convert column number (1, 2, ..., 26, 27, 28, ...) to letter (A, B, ..., Z, AA, AB, ...)
 * Excel max columns: 16384 (XFD)
 */
function columnNumberToLetter(num: number): string {
  if (num < 1) {
    throw new Error(`Invalid column number: ${num}. Must be >= 1`);
  }
  if (num > 16384) {
    throw new Error(`Invalid column number: ${num}. Excel maximum is 16384 (XFD)`);
  }
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode('A'.charCodeAt(0) + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

/**
 * Format criteria for Excel formulas (SUMIF, COUNTIF, etc.)
 * Handles:
 * - Simple text: "Apple" → ""Apple""
 * - Comparison operators: ">100" → "">100""
 * - Cell references with concatenation: ">="&A1 → kept as-is
 * - Already quoted criteria: "text" → kept as-is
 */
function formatFormulaCriteria(criteria: string): string {
  // If criteria contains & (concatenation) with cell reference pattern, use as-is
  // Pattern: looks for &$?[A-Z]+$?\d+ or &$?[A-Z]+:$?[A-Z]+ (cell or range reference)
  const cellRefPattern = /&\$?[A-Z]+\$?\d+|&\$?[A-Z]+:\$?[A-Z]+/i;
  if (cellRefPattern.test(criteria)) {
    // Already contains cell reference concatenation, return as-is
    return criteria;
  }

  // If criteria starts and ends with quotes, user explicitly formatted it
  if (criteria.startsWith('"') && criteria.endsWith('"')) {
    return criteria;
  }

  // Standard case: wrap in quotes with proper escaping
  const escaped = criteria.replace(/"/g, '""');
  return `"${escaped}"`;
}

export class ExcelClient extends OfficeClientBase {
  protected override comProgId = 'Excel.Application';

  async excelLaunch(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  $excel.Visible = -1  # msoTrue
  @{ success = $true; message = "Connected to existing Excel instance" } | ConvertTo-Json -Compress
} catch {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = -1  # msoTrue
  @{ success = $true; message = "Launched new Excel instance" } | ConvertTo-Json -Compress
}
`);
  }

  async excelCreate(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
} catch {
  $excel = New-Object -ComObject Excel.Application
}
$excel.DisplayAlerts = $false
$excel.Visible = -1  # msoTrue
$workbook = $excel.Workbooks.Add()
$excel.DisplayAlerts = $true
@{ success = $true; message = "Created new workbook"; workbook_name = $workbook.Name } | ConvertTo-Json -Compress
`);
  }

  async excelOpen(filePath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    return this.executePowerShell(`
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
} catch {
  $excel = New-Object -ComObject Excel.Application
}
$excel.DisplayAlerts = $false
$excel.Visible = -1  # msoTrue
$workbook = $excel.Workbooks.Open('${windowsPath}')
$excel.DisplayAlerts = $true
@{ success = $true; message = "Workbook opened"; workbook_name = $workbook.Name; path = $workbook.FullName } | ConvertTo-Json -Compress
`);
  }

  async excelWriteCell(
    cell: string,
    value: unknown,
    sheet?: string,
    options?: { fontName?: string; fontSize?: number; bold?: boolean; asText?: boolean }
  ): Promise<OfficeResponse> {
    const strValue = String(value);
    const escapedValue = strValue.replace(/'/g, "''");
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';

    // Auto-detect Korean and set font
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(strValue);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : '');

    const formatScript: string[] = [];
    if (fontName) formatScript.push(`$range.Font.Name = '${fontName.replace(/'/g, "''")}'`);
    if (options?.fontSize) formatScript.push(`$range.Font.Size = ${options.fontSize}`);
    if (options?.bold !== undefined) formatScript.push(`$range.Font.Bold = ${options.bold ? '$true' : '$false'}`);

    // Determine how to set the value:
    // - Numbers: set without quotes so Excel recognizes them
    // - Dates (YYYY-MM-DD, MM/DD/YYYY): use DateValue or let Excel parse
    // - asText option: force text format
    // - Otherwise: let Excel auto-detect (without forcing string)
    let valueScript: string;

    if (options?.asText) {
      // Force text format
      valueScript = `$range.NumberFormat = '@'; $range.Value = '${escapedValue}'`;
    } else if (strValue.startsWith('=')) {
      // Formula — set via .Formula so Excel evaluates it (not as text)
      valueScript = `$range.Formula = '${escapedValue}'`;
    } else if (typeof value === 'number' || (strValue !== '' && !isNaN(Number(strValue)) && strValue.trim() !== '')) {
      // Numeric value - don't quote
      valueScript = `$range.Value = ${strValue}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
      // ISO date format (YYYY-MM-DD) - convert to Excel date
      const [year, month, day] = strValue.split('-');
      valueScript = `$range.Value = (Get-Date -Year ${year} -Month ${month} -Day ${day}).ToOADate()`;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(strValue)) {
      // US date format (MM/DD/YYYY) - let Excel parse
      valueScript = `$range.Value = '${escapedValue}'`;
    } else {
      // Default: set as-is and let Excel auto-detect
      valueScript = `$range.Value = '${escapedValue}'`;
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${cell}')
${valueScript}
${formatScript.join('\n')}
@{ success = $true; message = "Value written to ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelReadCell(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$value = $sheet.Range('${cell}').Value2
@{ success = $true; cell = '${cell}'; value = $value } | ConvertTo-Json -Compress
`);
  }

  async excelWriteRange(startCell: string, values: unknown[][], sheet?: string): Promise<OfficeResponse> {
    const rows = values.length;
    //        (   #N/A )
    const cols = Math.max(...values.map(row => (row ? row.length : 0)), 0);
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';

    // Check for Korean text in any cell
    let hasKorean = false;

    // Helper to convert value to PowerShell format
    const toPsValue = (v: unknown): string => {
      const str = String(v);
      if (/[-ㄱ-ㅎㅏ-ㅣ]/.test(str)) hasKorean = true;

      // Numbers: output without quotes
      if (typeof v === 'number' || (str !== '' && !isNaN(Number(str)) && str.trim() !== '')) {
        return str;
      }
      // ISO date (YYYY-MM-DD): convert to OADate expression
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const [year, month, day] = str.split('-');
        return `([DateTime]::new(${year},${month},${day})).ToOADate()`;
      }
      // Default: string with escaped quotes
      return `'${str.replace(/'/g, "''")}'`;
    };

    // Build proper 2D array (System.Object[,]) for Excel COM
    // PowerShell @(@(),@()) creates jagged arrays which Excel cannot assign to ranges
    const cellAssignments: string[] = [];
    const formulaCells: { row: number; col: number; formula: string }[] = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const str = String(row[j]);
        if (str.startsWith('=')) {
          // Track formula cells — will be set separately after bulk value assignment
          formulaCells.push({ row: i, col: j, formula: str.replace(/'/g, "''") });
          cellAssignments.push(`$data[${i},${j}] = ''`); // placeholder
        } else {
          cellAssignments.push(`$data[${i},${j}] = ${toPsValue(row[j])}`);
        }
      }
    }

    // After bulk assignment, set formula cells individually
    const formulaScript = formulaCells.map(f =>
      `$sheet.Cells($startRange.Row + ${f.row}, $startRange.Column + ${f.col}).Formula = '${f.formula}'`
    ).join('\n');

    // TEXT FIRST, FONT AFTER pattern (Microsoft recommended for Korean)
    const fontScript = hasKorean ? "$range.Font.Name = 'Malgun Gothic'" : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$startRange = $sheet.Range('${startCell}')
$endCell = $sheet.Cells($startRange.Row + ${rows - 1}, $startRange.Column + ${cols - 1})
$range = $sheet.Range($startRange, $endCell)
$data = New-Object 'object[,]' ${rows},${cols}
${cellAssignments.join('\n')}
$range.Value = $data
${formulaScript}
${fontScript}
@{ success = $true; message = "Range written from ${startCell} (${rows}x${cols})" } | ConvertTo-Json -Compress
`);
  }

  async excelReadRange(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    // Return cell-addressed data so LLM knows exact cell positions
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$rows = $range.Rows.Count
$cols = $range.Columns.Count
$startRow = $range.Row
$startCol = $range.Column
$lines = @()
for ($r = 0; $r -lt $rows; $r++) {
  $parts = @()
  for ($c = 0; $c -lt $cols; $c++) {
    $cell = $range.Cells($r + 1, $c + 1)
    $addr = $cell.Address($false, $false)
    $val = $cell.Value2
    if ($cell.HasFormula) { $val = $cell.Formula }
    if ($null -eq $val) { $val = '' }
    $parts += "$addr=$val"
  }
  $lines += ($parts -join ' | ')
}
$table = $lines -join [char]10
@{ success = $true; range = '${range}'; rows = $rows; columns = $cols; table = $table } | ConvertTo-Json -Compress -Depth 10
`);
  }

  async excelSave(filePath?: string): Promise<OfficeResponse> {
    const windowsPath = filePath ? this.toWindowsPath(filePath).replace(/'/g, "''") : '';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${windowsPath ? `$workbook.SaveAs('${windowsPath}')` : '$workbook.Save()'}
@{ success = $true; message = "Workbook saved"; path = $workbook.FullName } | ConvertTo-Json -Compress
`);
  }

  async excelClose(save: boolean = false): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$workbook.Close(${save ? '$true' : '$false'})
@{ success = $true; message = "Workbook closed" } | ConvertTo-Json -Compress
`);
  }

  async excelQuit(save: boolean = false): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
if (${save ? '$true' : '$false'}) {
  foreach ($wb in $excel.Workbooks) { $wb.Save() }
}
$excel.Quit()
@{ success = $true; message = "Excel closed" } | ConvertTo-Json -Compress
`);
  }

  async excelSetFormula(cell: string, formula: string, sheet?: string): Promise<OfficeResponse> {
    const escapedFormula = formula.replace(/'/g, "''");
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${escapedFormula}'
@{ success = $true; message = "Formula set in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetFont(
    range: string,
    options: {
      fontName?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      color?: string;
    },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const commands: string[] = [];
    if (options.fontName) commands.push(`$range.Font.Name = '${options.fontName.replace(/'/g, "''")}'`);
    if (options.fontSize) commands.push(`$range.Font.Size = ${options.fontSize}`);
    if (options.bold !== undefined) commands.push(`$range.Font.Bold = ${options.bold ? '$true' : '$false'}`);
    if (options.italic !== undefined) commands.push(`$range.Font.Italic = ${options.italic ? '$true' : '$false'}`);
    if (options.underline !== undefined) commands.push(`$range.Font.Underline = ${options.underline ? '2' : '0'}`);
    if (options.color) {
      const rgb = this.hexToRgb(options.color);
      if (rgb) commands.push(`$range.Font.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
${commands.join('\n')}
@{ success = $true; message = "Font properties set for ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetAlignment(
    range: string,
    options: {
      horizontal?: 'left' | 'center' | 'right';
      vertical?: 'top' | 'center' | 'bottom';
      wrapText?: boolean;
      orientation?: number;
    },
    sheet?: string
  ): Promise<OfficeResponse> {
    const hAlignMap: Record<string, number> = { left: -4131, center: -4108, right: -4152 };
    const vAlignMap: Record<string, number> = { top: -4160, center: -4108, bottom: -4107 };
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const commands: string[] = [];
    if (options.horizontal) commands.push(`$range.HorizontalAlignment = ${hAlignMap[options.horizontal]}`);
    if (options.vertical) commands.push(`$range.VerticalAlignment = ${vAlignMap[options.vertical]}`);
    if (options.wrapText !== undefined) commands.push(`$range.WrapText = ${options.wrapText ? '$true' : '$false'}`);
    if (options.orientation !== undefined) commands.push(`$range.Orientation = ${options.orientation}`);

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
${commands.join('\n')}
@{ success = $true; message = "Alignment set for ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetColumnWidth(column: string, width?: number, autoFit?: boolean, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$col = $sheet.Columns('${column}')
${autoFit ? '$col.AutoFit()' : `$col.ColumnWidth = ${width || 10}`}
@{ success = $true; message = "Column ${column} width set" } | ConvertTo-Json -Compress
`);
  }

  async excelSetRowHeight(row: number, height?: number, autoFit?: boolean, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$row = $sheet.Rows(${row})
${autoFit ? '$row.AutoFit()' : `$row.RowHeight = ${height || 15}`}
@{ success = $true; message = "Row ${row} height set" } | ConvertTo-Json -Compress
`);
  }

  async excelMergeCells(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${range}').Merge()
@{ success = $true; message = "Cells merged: ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetBorder(
    range: string,
    options: {
      style?: 'thin' | 'medium' | 'thick' | 'double' | 'dotted' | 'dashed';
      color?: string;
      edges?: ('left' | 'right' | 'top' | 'bottom' | 'all')[];
    },
    sheet?: string
  ): Promise<OfficeResponse> {
    // xlContinuous=1, xlDash=-4115, xlDot=-4118, xlDouble=-4119
    // For weight: xlThin=2, xlMedium=-4138, xlThick=4
    const styleMap: Record<string, number> = { thin: 1, medium: 1, thick: 1, double: -4119, dotted: -4118, dashed: -4115 };
    const weightMap: Record<string, number> = { thin: 2, medium: -4138, thick: 4, double: 2, dotted: 2, dashed: 2 };
    const edgeMap: Record<string, number> = { left: 7, right: 10, top: 8, bottom: 9, all: -1 };
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const edges = options.edges || ['all'];
    const borderStyle = options.style ? styleMap[options.style] : 1;
    const borderWeight = options.style ? weightMap[options.style] : 2;

    let borderScript = '';
    if (edges.includes('all')) {
      borderScript = `
$range.Borders.LineStyle = ${borderStyle}
$range.Borders.Weight = ${borderWeight}`;
    } else {
      borderScript = edges.map(e => `$range.Borders(${edgeMap[e]}).LineStyle = ${borderStyle}
$range.Borders(${edgeMap[e]}).Weight = ${borderWeight}`).join('\n');
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
${borderScript}
@{ success = $true; message = "Border set for ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetFill(range: string, color: string, sheet?: string): Promise<OfficeResponse> {
    const rgb = this.hexToRgb(color);
    const colorValue = rgb ? rgb.r + rgb.g * 256 + rgb.b * 65536 : 0;
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${range}').Interior.Color = ${colorValue}
@{ success = $true; message = "Fill color set for ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetNumberFormat(range: string, format: string, sheet?: string): Promise<OfficeResponse> {
    const escapedFormat = format.replace(/'/g, "''");
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${range}').NumberFormat = '${escapedFormat}'
@{ success = $true; message = "Number format set for ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelAddSheet(name?: string, position?: 'start' | 'end' | string): Promise<OfficeResponse> {
    const escapedName = name?.replace(/'/g, "''") || '';
    let positionScript = '';
    if (position === 'start') {
      positionScript = ', [ref]$workbook.Sheets(1)';
    } else if (position === 'end') {
      positionScript = ', , [ref]$workbook.Sheets($workbook.Sheets.Count)';
    } else if (position) {
      positionScript = `, , [ref]$workbook.Sheets('${position.replace(/'/g, "''")}')`;
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$newSheet = $workbook.Sheets.Add(${positionScript})
${escapedName ? `$newSheet.Name = '${escapedName}'` : ''}
@{ success = $true; message = "Sheet added"; sheet_name = $newSheet.Name } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteSheet(name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$workbook.Sheets('${escapedName}').Delete()
@{ success = $true; message = "Sheet '${escapedName}' deleted" } | ConvertTo-Json -Compress
`);
  }

  async excelRenameSheet(oldName: string, newName: string): Promise<OfficeResponse> {
    const escapedOld = oldName.replace(/'/g, "''");
    const escapedNew = newName.replace(/'/g, "''");
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$workbook.Sheets('${escapedOld}').Name = '${escapedNew}'
@{ success = $true; message = "Sheet renamed from '${escapedOld}' to '${escapedNew}'" } | ConvertTo-Json -Compress
`);
  }

  async excelCopySheet(sourceName: string, newName?: string, position?: 'before' | 'after', targetSheet?: string): Promise<OfficeResponse> {
    // Validate new sheet name if provided
    if (newName) {
      if (newName.length > 31) {
        return { success: false, error: 'Sheet name cannot exceed 31 characters' };
      }
      if (/[:\\/?*\[\]]/.test(newName)) {
        return { success: false, error: 'Sheet name cannot contain : \\ / ? * [ ]' };
      }
    }

    const escapedSource = sourceName.replace(/'/g, "''");
    const escapedNew = newName?.replace(/'/g, "''") || '';
    const escapedTarget = targetSheet?.replace(/'/g, "''") || '';

    let positionScript = '';
    if (position === 'before' && targetSheet) {
      positionScript = `$workbook.Sheets('${escapedSource}').Copy([ref]$workbook.Sheets('${escapedTarget}'))`;
    } else if (position === 'after' && targetSheet) {
      positionScript = `$workbook.Sheets('${escapedSource}').Copy($null, [ref]$workbook.Sheets('${escapedTarget}'))`;
    } else if (position && !targetSheet) {
      // position specified without targetSheet: use first or last sheet
      if (position === 'before') {
        positionScript = `$workbook.Sheets('${escapedSource}').Copy([ref]$workbook.Sheets(1))`;
      } else {
        positionScript = `$workbook.Sheets('${escapedSource}').Copy($null, [ref]$workbook.Sheets($workbook.Sheets.Count))`;
      }
    } else {
      // Default: copy after the source sheet
      positionScript = `$workbook.Sheets('${escapedSource}').Copy($null, [ref]$workbook.Sheets('${escapedSource}'))`;
    }

    return this.executePowerShell(`
try {
  $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  $workbook = $excel.ActiveWorkbook
  if (-not $workbook.Sheets('${escapedSource}')) {
    throw "Source sheet '${escapedSource}' not found"
  }
  ${positionScript}
  $newSheet = $workbook.ActiveSheet
  ${escapedNew ? `$newSheet.Name = '${escapedNew}'` : ''}
  @{ success = $true; message = "Sheet copied"; new_sheet_name = $newSheet.Name } | ConvertTo-Json -Compress
} catch {
  @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`);
  }

  async excelGetSheets(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$sheets = @()
foreach ($sheet in $workbook.Sheets) {
  $sheets += $sheet.Name
}
@{ success = $true; sheets = $sheets; count = $sheets.Count } | ConvertTo-Json -Compress
`);
  }

  async excelSortRange(
    range: string,
    sortColumn: string,
    ascending: boolean = true,
    hasHeader: boolean = true,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const order = ascending ? 1 : 2; // xlAscending = 1, xlDescending = 2
    const header = hasHeader ? 1 : 2; // xlYes = 1, xlNo = 2

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$sortKey = $sheet.Range('${sortColumn}1')

# Use Sort object for better compatibility
$sheet.Sort.SortFields.Clear()
$sheet.Sort.SortFields.Add($sortKey, 0, ${order})
$sheet.Sort.SetRange($range)
$sheet.Sort.Header = ${header}
$sheet.Sort.Apply()

@{ success = $true; message = "Range sorted by column ${sortColumn}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertRow(row: number, count: number = 1, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
for ($i = 0; $i -lt ${count}; $i++) {
  $sheet.Rows(${row}).Insert()
}
@{ success = $true; message = "${count} row(s) inserted at row ${row}" } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteRow(row: number, count: number = 1, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Rows("${row}:${row + count - 1}").Delete()
@{ success = $true; message = "${count} row(s) deleted starting at row ${row}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertColumn(column: string, count: number = 1, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
for ($i = 0; $i -lt ${count}; $i++) {
  $sheet.Columns('${column}').Insert()
}
@{ success = $true; message = "${count} column(s) inserted at column ${column}" } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteColumn(column: string, count: number = 1, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const startColNum = columnLetterToNumber(column.toUpperCase());
    const endCol = columnNumberToLetter(startColNum + count - 1);
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Columns("${column}:${endCol}").Delete()
@{ success = $true; message = "${count} column(s) deleted starting at column ${column}" } | ConvertTo-Json -Compress
`);
  }

  async excelFreezePanes(row?: number, column?: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    const cellRef = `${column || 'A'}${row || 1}`;
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Activate()
if ($excel.ActiveWindow.FreezePanes) { $excel.ActiveWindow.FreezePanes = $false }
$sheet.Range('${cellRef}').Select()
$excel.ActiveWindow.FreezePanes = $true
@{ success = $true; message = "Panes frozen at ${cellRef}" } | ConvertTo-Json -Compress
`);
  }

  async excelAutoFilter(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ? `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` : '$sheet = $workbook.ActiveSheet';
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${range}').AutoFilter()
@{ success = $true; message = "AutoFilter applied to ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelScreenshot(): Promise<ScreenshotResponse> {
    const result = await this.executePowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$sheet = $excel.ActiveWorkbook.ActiveSheet

# Get used range and copy as picture
$usedRange = $sheet.UsedRange
$usedRange.CopyPicture(1, 2)  # xlScreen=1, xlBitmap=2

# Get image from clipboard
Start-Sleep -Milliseconds 500
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) {
  @{ success = $false; error = "Failed to capture screenshot" } | ConvertTo-Json -Compress
  return
}

# Convert to JPEG quality 60 for smaller context footprint
$ms = New-Object System.IO.MemoryStream
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]60)
$img.Save($ms, $jpegCodec, $encoderParams)
$bytes = $ms.ToArray()
$base64 = [Convert]::ToBase64String($bytes)
$ms.Dispose()
$img.Dispose()

@{
  success = $true
  image = $base64
  format = "jpeg"
  encoding = "base64"
} | ConvertTo-Json -Compress
`);
    return result as ScreenshotResponse;
  }

  // -------------------------------------------------------------------------
  // Excel Charts
  // -------------------------------------------------------------------------

  async excelAddChart(
    dataRange: string,
    chartType: 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut',
    options?: {
      title?: string;
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      sheet?: string;
      categoryRange?: string;
    }
  ): Promise<OfficeResponse> {
    // Excel chart types
    const chartTypeMap: Record<string, number> = {
      column: 51,      // xlColumnClustered
      bar: 57,         // xlBarClustered
      line: 4,         // xlLine
      pie: 5,          // xlPie
      area: 1,         // xlArea
      scatter: -4169,  // xlXYScatter
      doughnut: -4120, // xlDoughnut
    };
    const xlChartType = chartTypeMap[chartType] ?? 51;
    const escapedTitle = options?.title?.replace(/'/g, "''") || '';
    const hasKorean = options?.title ? /[-ㄱ-ㅎㅏ-ㅣ]/.test(options.title) : false;

    const sheetScript = options?.sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${options.sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const left = options?.left ?? 100;
    const top = options?.top ?? 100;
    const width = options?.width ?? 400;
    const height = options?.height ?? 300;

    // TEXT FIRST, FONT AFTER pattern (Microsoft recommended for Korean)
    const titleScript = escapedTitle ? `
$chart.HasTitle = $true
$chart.ChartTitle.Text = '${escapedTitle}'
${hasKorean ? "$chart.ChartTitle.Font.Name = 'Malgun Gothic'" : ''}` : '';

    // Korean font for legend and axis labels (apply when title has Korean or data may contain Korean)
    const koreanFontScript = hasKorean ? `
# Apply Malgun Gothic to legend
if ($chart.HasLegend) {
  $chart.Legend.Font.Name = 'Malgun Gothic'
}
# Apply to axis labels (Category and Value axes)
try {
  $chart.Axes(1).TickLabels.Font.Name = 'Malgun Gothic'  # xlCategory
  $chart.Axes(2).TickLabels.Font.Name = 'Malgun Gothic'  # xlValue
} catch { }` : '';

    // Set category (X-axis) labels from a separate range
    const categoryScript = options?.categoryRange ? `
try {
  $catRange = $sheet.Range('${options.categoryRange}')
  for ($i = 1; $i -le $chart.SeriesCollection().Count; $i++) {
    $chart.SeriesCollection($i).XValues = $catRange
  }
} catch { }` : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${dataRange}')
$chartObj = $sheet.ChartObjects().Add(${left}, ${top}, ${width}, ${height})
$chart = $chartObj.Chart
$chart.SetSourceData($range)
$chart.ChartType = ${xlChartType}
${categoryScript}
${titleScript}
${koreanFontScript}
@{ success = $true; message = "Chart added"; chart_name = $chartObj.Name } | ConvertTo-Json -Compress
`);
  }

  async excelSetChartTitle(chartIndex: number, title: string, sheet?: string): Promise<OfficeResponse> {
    const escapedTitle = title.replace(/'/g, "''");
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(title);
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    // TEXT FIRST, FONT AFTER pattern (Microsoft recommended for Korean)
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
$chart.HasTitle = $true
$chart.ChartTitle.Text = '${escapedTitle}'
${hasKorean ? "$chart.ChartTitle.Font.Name = 'Malgun Gothic'" : ''}
@{ success = $true; message = "Chart title set" } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteChart(chartIndex: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.ChartObjects(${chartIndex}).Delete()
@{ success = $true; message = "Chart deleted" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Conditional Formatting
  // -------------------------------------------------------------------------

  async excelAddConditionalFormat(
    range: string,
    formatType: 'cellValue' | 'colorScale' | 'dataBar' | 'iconSet' | 'duplicates' | 'top10',
    options?: {
      operator?: 'greater' | 'less' | 'equal' | 'between' | 'notBetween';
      value1?: string | number;
      value2?: string | number;
      fillColor?: string;
      fontColor?: string;
      sheet?: string;
    }
  ): Promise<OfficeResponse> {
    const sheetScript = options?.sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${options.sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    // xlFormatConditionType: xlCellValue=1, xlColorScale=3, xlDataBar=4, xlIconSet=6, xlUniqueValues=8, xlTop10=5
    const typeMap: Record<string, number> = {
      cellValue: 1,
      colorScale: 3,
      dataBar: 4,
      iconSet: 6,
      duplicates: 8,
      top10: 5,
    };
    const conditionType = typeMap[formatType] ?? 1;

    // xlOperator: xlGreater=5, xlLess=6, xlEqual=3, xlBetween=1, xlNotBetween=2
    const operatorMap: Record<string, number> = {
      greater: 5,
      less: 6,
      equal: 3,
      between: 1,
      notBetween: 2,
    };
    const xlOperator = options?.operator ? operatorMap[options.operator] : 5;

    let formatScript = '';
    if (formatType === 'cellValue') {
      const formula1 = typeof options?.value1 === 'string' ? `"${options.value1}"` : options?.value1 ?? 0;
      const formula2 = options?.value2 !== undefined ?
        (typeof options.value2 === 'string' ? `"${options.value2}"` : options.value2) : '';

      formatScript = `
$fc = $range.FormatConditions.Add(${conditionType}, ${xlOperator}, ${formula1}${formula2 ? `, ${formula2}` : ''})`;

      if (options?.fillColor) {
        const rgb = this.hexToRgb(options.fillColor);
        if (rgb) {
          formatScript += `\n$fc.Interior.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
        }
      }
      if (options?.fontColor) {
        const rgb = this.hexToRgb(options.fontColor);
        if (rgb) {
          formatScript += `\n$fc.Font.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
        }
      }
    } else if (formatType === 'colorScale') {
      formatScript = '$range.FormatConditions.AddColorScale(3)';
    } else if (formatType === 'dataBar') {
      formatScript = '$range.FormatConditions.AddDataBar()';
    } else if (formatType === 'iconSet') {
      formatScript = '$range.FormatConditions.AddIconSetCondition()';
    } else if (formatType === 'duplicates') {
      formatScript = `$fc = $range.FormatConditions.AddUniqueValues()
$fc.DupeUnique = 1`;  // xlDuplicate
      if (options?.fillColor) {
        const rgb = this.hexToRgb(options.fillColor);
        if (rgb) {
          formatScript += `\n$fc.Interior.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
        }
      }
    } else if (formatType === 'top10') {
      formatScript = `$fc = $range.FormatConditions.AddTop10()
$fc.TopBottom = 1
$fc.Rank = 10`;
      if (options?.fillColor) {
        const rgb = this.hexToRgb(options.fillColor);
        if (rgb) {
          formatScript += `\n$fc.Interior.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
        }
      }
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${range}')
${formatScript}
@{ success = $true; message = "Conditional format added to ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelClearConditionalFormat(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').FormatConditions.Delete()
@{ success = $true; message = "Conditional formatting cleared from ${range}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Data Validation
  // -------------------------------------------------------------------------

  async excelSetDataValidation(
    range: string,
    validationType: 'list' | 'whole' | 'decimal' | 'date' | 'textLength' | 'custom',
    options: {
      formula1?: string;
      formula2?: string;
      operator?: 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greater' | 'less' | 'greaterEqual' | 'lessEqual';
      showInputMessage?: boolean;
      inputTitle?: string;
      inputMessage?: string;
      showErrorMessage?: boolean;
      errorTitle?: string;
      errorMessage?: string;
      sheet?: string;
    }
  ): Promise<OfficeResponse> {
    const sheetScript = options?.sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${options.sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    // xlDVType: xlValidateList=3, xlValidateWholeNumber=1, xlValidateDecimal=2, xlValidateDate=4, xlValidateTextLength=6, xlValidateCustom=7
    const typeMap: Record<string, number> = {
      list: 3,
      whole: 1,
      decimal: 2,
      date: 4,
      textLength: 6,
      custom: 7,
    };
    const dvType = typeMap[validationType] ?? 3;

    // xlDVAlertStyle: xlValidAlertStop=1
    // xlOperator
    const operatorMap: Record<string, number> = {
      between: 1,
      notBetween: 2,
      equal: 3,
      notEqual: 4,
      greater: 5,
      less: 6,
      greaterEqual: 7,
      lessEqual: 8,
    };
    const xlOperator = options.operator ? operatorMap[options.operator] : 1;

    const formula1 = options.formula1?.replace(/'/g, "''") || '';
    const formula2 = options.formula2?.replace(/'/g, "''") || '';

    const additionalSettings: string[] = [];
    if (options.showInputMessage !== false && (options.inputTitle || options.inputMessage)) {
      additionalSettings.push('$validation.ShowInput = $true');
      if (options.inputTitle) additionalSettings.push(`$validation.InputTitle = '${options.inputTitle.replace(/'/g, "''")}'`);
      if (options.inputMessage) additionalSettings.push(`$validation.InputMessage = '${options.inputMessage.replace(/'/g, "''")}'`);
    }
    if (options.showErrorMessage !== false && (options.errorTitle || options.errorMessage)) {
      additionalSettings.push('$validation.ShowError = $true');
      if (options.errorTitle) additionalSettings.push(`$validation.ErrorTitle = '${options.errorTitle.replace(/'/g, "''")}'`);
      if (options.errorMessage) additionalSettings.push(`$validation.ErrorMessage = '${options.errorMessage.replace(/'/g, "''")}'`);
    }

    // For list validation, operator parameter is not used
    const validationParams = validationType === 'list'
      ? `${dvType}, 1, 1, '${formula1}'`  // List: Type, AlertStyle, Operator (ignored), Formula1
      : `${dvType}, 1, ${xlOperator}, '${formula1}'${formula2 ? `, '${formula2}'` : ''}`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${range}')
$range.Validation.Delete()
$range.Validation.Add(${validationParams})
$validation = $range.Validation
${additionalSettings.join('\n')}
@{ success = $true; message = "Data validation set on ${range}" } | ConvertTo-Json -Compress
`);
  }

  async excelClearDataValidation(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').Validation.Delete()
@{ success = $true; message = "Data validation cleared from ${range}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Named Ranges
  // -------------------------------------------------------------------------

  async excelCreateNamedRange(name: string, range: string, sheet?: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$workbook.Names.Add('${escapedName}', $range)
@{ success = $true; message = "Named range '${escapedName}' created" } | ConvertTo-Json -Compress
`);
  }

  async excelGetNamedRanges(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$names = @()
foreach ($n in $workbook.Names) {
  $names += @{
    name = $n.Name
    refersTo = $n.RefersTo
    value = $n.Value
  }
}
@{ success = $true; named_ranges = $names } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async excelDeleteNamedRange(name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$workbook.Names('${escapedName}').Delete()
@{ success = $true; message = "Named range '${escapedName}' deleted" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Copy/Paste/Clear
  // -------------------------------------------------------------------------

  async excelCopyRange(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').Copy()
@{ success = $true; message = "Range ${range} copied to clipboard" } | ConvertTo-Json -Compress
`);
  }

  async excelPasteRange(destination: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${destination}').Select()
$sheet.Paste()
@{ success = $true; message = "Pasted to ${destination}" } | ConvertTo-Json -Compress
`);
  }

  async excelClearRange(
    range: string,
    clearType: 'all' | 'contents' | 'formats' | 'comments' = 'all',
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const clearMethod = {
      all: 'Clear()',
      contents: 'ClearContents()',
      formats: 'ClearFormats()',
      comments: 'ClearComments()',
    }[clearType];

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').${clearMethod}
@{ success = $true; message = "Range ${range} cleared (${clearType})" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Hide/Show Rows & Columns
  // -------------------------------------------------------------------------

  async excelHideColumn(column: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Columns('${column}').Hidden = $true
@{ success = $true; message = "Column ${column} hidden" } | ConvertTo-Json -Compress
`);
  }

  async excelShowColumn(column: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Columns('${column}').Hidden = $false
@{ success = $true; message = "Column ${column} shown" } | ConvertTo-Json -Compress
`);
  }

  async excelHideRow(row: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Rows(${row}).Hidden = $true
@{ success = $true; message = "Row ${row} hidden" } | ConvertTo-Json -Compress
`);
  }

  async excelShowRow(row: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Rows(${row}).Hidden = $false
@{ success = $true; message = "Row ${row} shown" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Image & Hyperlink
  // -------------------------------------------------------------------------

  async excelAddImage(
    imagePath: string,
    cell: string,
    options?: { width?: number; height?: number; sheet?: string }
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(imagePath).replace(/'/g, "''");
    const sheetScript = options?.sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${options.sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const sizeScript = [];
    if (options?.width) sizeScript.push(`$pic.Width = ${options.width}`);
    if (options?.height) sizeScript.push(`$pic.Height = ${options.height}`);

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$cell = $sheet.Range('${cell}')
$pic = $sheet.Shapes.AddPicture('${windowsPath}', 0, -1, $cell.Left, $cell.Top, -1, -1)
${sizeScript.join('\n')}
@{ success = $true; message = "Image added at ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelAddHyperlink(
    cell: string,
    url: string,
    displayText?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const escapedUrl = url.replace(/'/g, "''");
    const escapedText = displayText?.replace(/'/g, "''") || url;
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${cell}')
$sheet.Hyperlinks.Add($range, '${escapedUrl}', '', '', '${escapedText}')
@{ success = $true; message = "Hyperlink added to ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelGetHyperlinks(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$links = @()
foreach ($hl in $sheet.Hyperlinks) {
  $links += @{
    cell = $hl.Range.Address($false, $false)
    address = $hl.Address
    subAddress = $hl.SubAddress
    textToDisplay = $hl.TextToDisplay
    screenTip = $hl.ScreenTip
  }
}
@{ success = $true; hyperlinks = $links; count = $links.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async excelDeleteHyperlink(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${cell}')
$found = $false
foreach ($hl in $sheet.Hyperlinks) {
  if ($hl.Range.Address -eq $range.Address) {
    $hl.Delete()
    $found = $true
    break
  }
}
if ($found) {
  @{ success = $true; message = "Hyperlink deleted from ${cell}" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "No hyperlink found in ${cell}" } | ConvertTo-Json -Compress
}
`);
  }

  async excelEditHyperlink(
    cell: string,
    newUrl?: string,
    newDisplayText?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    const urlUpdate = newUrl ? `$hl.Address = '${newUrl.replace(/'/g, "''")}'` : '';
    const textUpdate = newDisplayText ? `$hl.TextToDisplay = '${newDisplayText.replace(/'/g, "''")}'` : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${cell}')
$found = $false
foreach ($hl in $sheet.Hyperlinks) {
  if ($hl.Range.Address -eq $range.Address) {
    ${urlUpdate}
    ${textUpdate}
    $found = $true
    break
  }
}
if ($found) {
  @{ success = $true; message = "Hyperlink updated in ${cell}" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "No hyperlink found in ${cell}" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Excel Export & Print
  // -------------------------------------------------------------------------

  async excelExportPDF(outputPath: string, sheet?: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(outputPath).replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')
$sheet.ExportAsFixedFormat(0, '${windowsPath}')` :
      `$excel.ActiveWorkbook.ExportAsFixedFormat(0, '${windowsPath}')`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
@{ success = $true; message = "Exported to PDF"; path = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  async excelPrint(copies: number = 1, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')
$sheet.PrintOut(1, 9999, ${copies})` :
      `$excel.ActiveWorkbook.PrintOut(1, 9999, ${copies})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
@{ success = $true; message = "Print job sent (${copies} copies)" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Comments
  // -------------------------------------------------------------------------

  async excelAddComment(cell: string, text: string, _author?: string, sheet?: string): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$cell = $sheet.Range('${cell}')
if ($cell.Comment -ne $null) { $cell.Comment.Delete() }
$comment = $cell.AddComment('${escapedText}')
$comment.Visible = $false
@{ success = $true; message = "Comment added to ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelGetComment(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$cell = $sheet.Range('${cell}')
if ($cell.Comment -ne $null) {
  @{ success = $true; has_comment = $true; text = $cell.Comment.Text() } | ConvertTo-Json -Compress
} else {
  @{ success = $true; has_comment = $false } | ConvertTo-Json -Compress
}
`);
  }

  async excelDeleteComment(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$cell = $sheet.Range('${cell}')
if ($cell.Comment -ne $null) {
  $cell.Comment.Delete()
  @{ success = $true; message = "Comment deleted from ${cell}" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "No comment found at ${cell}" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Excel Sheet Protection
  // -------------------------------------------------------------------------

  async excelProtectSheet(password?: string, sheet?: string): Promise<OfficeResponse> {
    const escapedPassword = password?.replace(/'/g, "''") || '';
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Protect('${escapedPassword}')
@{ success = $true; message = "Sheet protected" } | ConvertTo-Json -Compress
`);
  }

  async excelUnprotectSheet(password?: string, sheet?: string): Promise<OfficeResponse> {
    const escapedPassword = password?.replace(/'/g, "''") || '';
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Unprotect('${escapedPassword}')
@{ success = $true; message = "Sheet unprotected" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Unmerge Cells
  // -------------------------------------------------------------------------

  async excelUnmergeCells(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').UnMerge()
@{ success = $true; message = "Cells unmerged: ${range}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Select/Activate Sheet
  // -------------------------------------------------------------------------

  async excelSelectSheet(name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$excel.ActiveWorkbook.Worksheets('${escapedName}').Activate()
@{ success = $true; message = "Sheet '${escapedName}' activated" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Find & Replace
  // -------------------------------------------------------------------------

  async excelFindReplace(
    find: string,
    replace: string,
    options?: {
      matchCase?: boolean;
      matchEntireCell?: boolean;
      range?: string;
      sheet?: string;
    }
  ): Promise<OfficeResponse> {
    const escapedFind = find.replace(/'/g, "''");
    const escapedReplace = replace.replace(/'/g, "''");
    const sheetScript = options?.sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${options.sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const rangeScript = options?.range ?
      `$range = $sheet.Range('${options.range}')` :
      '$range = $sheet.UsedRange';

    const matchCase = options?.matchCase ? '$true' : '$false';
    const lookAt = options?.matchEntireCell ? '1' : '2';  // xlWhole=1, xlPart=2

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
${rangeScript}
$replaced = $range.Replace('${escapedFind}', '${escapedReplace}', ${lookAt}, 1, ${matchCase})
@{ success = $true; message = "Find and replace completed" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Group Rows
  // -------------------------------------------------------------------------

  async excelGroupRows(startRow: number, endRow: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Rows("${startRow}:${endRow}").Group()
@{ success = $true; message = "Rows ${startRow}-${endRow} grouped" } | ConvertTo-Json -Compress
`);
  }

  async excelUngroupRows(startRow: number, endRow: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Rows("${startRow}:${endRow}").Ungroup()
@{ success = $true; message = "Rows ${startRow}-${endRow} ungrouped" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Pivot Table
  // -------------------------------------------------------------------------

  async excelCreatePivotTable(
    sourceRange: string,
    destCell: string,
    tableName?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const escapedName = tableName?.replace(/'/g, "''") || `PivotTable${Date.now()}`;
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sourceRange = $sheet.Range('${sourceRange}')
$destRange = $sheet.Range('${destCell}')

$pivotCache = $workbook.PivotCaches().Create(1, $sourceRange)  # xlDatabase = 1
$pivotTable = $pivotCache.CreatePivotTable($destRange, '${escapedName}')

@{ success = $true; message = "Pivot table created"; table_name = '${escapedName}' } | ConvertTo-Json -Compress
`);
  }

  async excelAddPivotField(
    tableName: string,
    fieldName: string,
    orientation: 'row' | 'column' | 'data' | 'page',
    aggregateFunction?: 'sum' | 'count' | 'average' | 'max' | 'min'
  ): Promise<OfficeResponse> {
    const escapedTableName = tableName.replace(/'/g, "''");
    const escapedFieldName = fieldName.replace(/'/g, "''");

    // xlRowField=1, xlColumnField=2, xlDataField=4, xlPageField=3
    const orientationMap: Record<string, number> = {
      row: 1,
      column: 2,
      data: 4,
      page: 3,
    };
    const xlOrientation = orientationMap[orientation];

    // xlSum=-4157, xlCount=-4112, xlAverage=-4106, xlMax=-4136, xlMin=-4139
    const functionMap: Record<string, number> = {
      sum: -4157,
      count: -4112,
      average: -4106,
      max: -4136,
      min: -4139,
    };
    const xlFunction = aggregateFunction ? functionMap[aggregateFunction] : -4157;

    const functionScript = orientation === 'data' ? `$field.Function = ${xlFunction}` : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$pivotTable = $null
foreach ($ws in $workbook.Worksheets) {
  foreach ($pt in $ws.PivotTables()) {
    if ($pt.Name -eq '${escapedTableName}') {
      $pivotTable = $pt
      break
    }
  }
  if ($pivotTable -ne $null) { break }
}

if ($pivotTable -eq $null) {
  @{ success = $false; error = "Pivot table '${escapedTableName}' not found" } | ConvertTo-Json -Compress
} else {
  $field = $pivotTable.PivotFields('${escapedFieldName}')
  $field.Orientation = ${xlOrientation}
  ${functionScript}
  @{ success = $true; message = "Field '${escapedFieldName}' added as ${orientation}" } | ConvertTo-Json -Compress
}
`);
  }

  async excelRefreshPivotTable(tableName: string): Promise<OfficeResponse> {
    const escapedTableName = tableName.replace(/'/g, "''");

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$pivotTable = $null
foreach ($ws in $workbook.Worksheets) {
  foreach ($pt in $ws.PivotTables()) {
    if ($pt.Name -eq '${escapedTableName}') {
      $pivotTable = $pt
      break
    }
  }
  if ($pivotTable -ne $null) { break }
}

if ($pivotTable -eq $null) {
  @{ success = $false; error = "Pivot table '${escapedTableName}' not found" } | ConvertTo-Json -Compress
} else {
  $pivotTable.RefreshTable()
  @{ success = $true; message = "Pivot table '${escapedTableName}' refreshed" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Excel Formula Helpers
  // -------------------------------------------------------------------------

  async excelInsertVlookup(
    cell: string,
    lookupValue: string,
    tableRange: string,
    colIndex: number,
    exactMatch: boolean = true,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const matchType = exactMatch ? 'FALSE' : 'TRUE';
    const formula = `=VLOOKUP(${lookupValue},${tableRange},${colIndex},${matchType})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "VLOOKUP formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertSumif(
    cell: string,
    range: string,
    criteria: string,
    sumRange?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const formattedCriteria = formatFormulaCriteria(criteria);
    const formula = sumRange
      ? `=SUMIF(${range},${formattedCriteria},${sumRange})`
      : `=SUMIF(${range},${formattedCriteria})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "SUMIF formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertCountif(
    cell: string,
    range: string,
    criteria: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const formattedCriteria = formatFormulaCriteria(criteria);
    const formula = `=COUNTIF(${range},${formattedCriteria})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "COUNTIF formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertIndexMatch(
    cell: string,
    returnRange: string,
    lookupRange: string,
    lookupValue: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const formula = `=INDEX(${returnRange},MATCH(${lookupValue},${lookupRange},0))`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "INDEX-MATCH formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertAverageif(
    cell: string,
    range: string,
    criteria: string,
    avgRange?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const formattedCriteria = formatFormulaCriteria(criteria);
    const formula = avgRange
      ? `=AVERAGEIF(${range},${formattedCriteria},${avgRange})`
      : `=AVERAGEIF(${range},${formattedCriteria})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "AVERAGEIF formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertSumifs(
    cell: string,
    sumRange: string,
    criteriaRanges: string[],
    criteria: string[],
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // Build criteria pairs using formatFormulaCriteria helper
    const criteriaPairs = criteriaRanges.map((range, i) => {
      const formattedCriteria = formatFormulaCriteria(criteria[i] || '');
      return `${range},${formattedCriteria}`;
    }).join(',');

    const formula = `=SUMIFS(${sumRange},${criteriaPairs})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "SUMIFS formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertCountifs(
    cell: string,
    criteriaRanges: string[],
    criteria: string[],
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // Build criteria pairs using formatFormulaCriteria helper
    const criteriaPairs = criteriaRanges.map((range, i) => {
      const formattedCriteria = formatFormulaCriteria(criteria[i] || '');
      return `${range},${formattedCriteria}`;
    }).join(',');

    const formula = `=COUNTIFS(${criteriaPairs})`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "COUNTIFS formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelInsertXlookup(
    cell: string,
    lookupValue: string,
    lookupRange: string,
    returnRange: string,
    notFoundValue?: string,
    matchMode?: 'exact' | 'exactOrNext' | 'exactOrPrev' | 'wildcard',
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // Match mode: 0=exact, 1=exact or next, -1=exact or prev, 2=wildcard
    const matchModeMap: Record<string, number> = {
      exact: 0,
      exactOrNext: 1,
      exactOrPrev: -1,
      wildcard: 2,
    };
    const matchModeValue = matchMode ? matchModeMap[matchMode] : 0;

    // Build XLOOKUP formula: =XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode])
    let formula = `=XLOOKUP(${lookupValue},${lookupRange},${returnRange}`;
    if (notFoundValue !== undefined || matchMode) {
      // If either optional param is needed, we must include if_not_found slot
      if (notFoundValue !== undefined) {
        formula += `,"${notFoundValue.replace(/"/g, '""')}"`;
      } else {
        formula += ','; // Empty slot for if_not_found
      }
      // Add match_mode if specified (or default 0 if notFoundValue was provided)
      if (matchMode || notFoundValue !== undefined) {
        formula += `,${matchModeValue}`;
      }
    }
    formula += ')';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.Range('${cell}').Formula = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "XLOOKUP formula inserted in ${cell}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Unmerge and Fill
  // -------------------------------------------------------------------------

  async excelUnmergeAndFill(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    // Optimized: Find merge areas first, then process each unique merge area once
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${range}')
$filledCount = 0
$processedAreas = @{}

# Find all merge areas in the range (check first cell of each row for efficiency)
foreach ($cell in $range) {
  if ($cell.MergeCells) {
    $mergeArea = $cell.MergeArea
    $areaAddress = $mergeArea.Address

    # Skip if already processed
    if (-not $processedAreas.ContainsKey($areaAddress)) {
      $processedAreas[$areaAddress] = $true
      $originalValue = $mergeArea.Cells(1, 1).Value2
      $cellCount = $mergeArea.Cells.Count
      $mergeArea.UnMerge()

      # Fill all cells at once using Value assignment
      $mergeArea.Value2 = $originalValue
      $filledCount += $cellCount
    }
  }
}

@{ success = $true; message = "Unmerged and filled ${range} ($($processedAreas.Count) merge areas)"; cells_filled = $filledCount; merge_areas = $processedAreas.Count } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Chart Series
  // -------------------------------------------------------------------------

  async excelAddChartSeries(
    chartIndex: number,
    valuesRange: string,
    nameRange?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const nameScript = nameRange ? `$series.Name = $sheet.Range('${nameRange}').Value2` : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
$series = $chart.SeriesCollection().NewSeries()
$series.Values = $sheet.Range('${valuesRange}')
${nameScript}
@{ success = $true; message = "Series added to chart"; series_index = $chart.SeriesCollection().Count } | ConvertTo-Json -Compress
`);
  }

  async excelEditChartSeries(
    chartIndex: number,
    seriesIndex: number,
    options: {
      valuesRange?: string;
      nameRange?: string;
      name?: string;
    },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const commands: string[] = [];
    if (options.valuesRange) {
      commands.push(`$series.Values = $sheet.Range('${options.valuesRange}')`);
    }
    if (options.nameRange) {
      commands.push(`$series.Name = $sheet.Range('${options.nameRange}').Value2`);
    }
    if (options.name) {
      commands.push(`$series.Name = '${options.name.replace(/'/g, "''")}'`);
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
$series = $chart.SeriesCollection(${seriesIndex})
${commands.join('\n')}
@{ success = $true; message = "Series ${seriesIndex} updated" } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteChartSeries(chartIndex: number, seriesIndex: number, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
$chart.SeriesCollection(${seriesIndex}).Delete()
@{ success = $true; message = "Series ${seriesIndex} deleted from chart" } | ConvertTo-Json -Compress
`);
  }

  async excelSetChartLegend(
    chartIndex: number,
    options: { show?: boolean; position?: 'bottom' | 'top' | 'left' | 'right' | 'corner' },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const positionMap: Record<string, number> = {
      bottom: -4107,
      top: -4160,
      left: -4131,
      right: -4152,
      corner: 2,
    };

    let legendScript = '';
    if (options.show === false) {
      legendScript = '$chart.HasLegend = $false';
    } else {
      legendScript = '$chart.HasLegend = $true';
      if (options.position) {
        legendScript += `; $chart.Legend.Position = ${positionMap[options.position]}`;
      }
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
${legendScript}
@{ success = $true; message = "Chart legend updated" } | ConvertTo-Json -Compress
`);
  }

  async excelSetChartDataLabels(
    chartIndex: number,
    options: { show?: boolean; showValue?: boolean; showCategory?: boolean; showPercent?: boolean },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const labelScript = options.show === false
      ? 'foreach ($s in $chart.SeriesCollection()) { $s.HasDataLabels = $false }'
      : `foreach ($s in $chart.SeriesCollection()) {
  $s.HasDataLabels = $true
  $s.DataLabels.ShowValue = ${options.showValue !== false ? '$true' : '$false'}
  $s.DataLabels.ShowCategoryName = ${options.showCategory ? '$true' : '$false'}
  $s.DataLabels.ShowPercentage = ${options.showPercent ? '$true' : '$false'}
}`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
${labelScript}
@{ success = $true; message = "Chart data labels updated" } | ConvertTo-Json -Compress
`);
  }

  async excelSetChartAxis(
    chartIndex: number,
    axisType: 'x' | 'y',
    options: { title?: string; min?: number; max?: number; majorUnit?: number },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const axisNum = axisType === 'x' ? 1 : 2;

    let axisScript = `$axis = $chart.Axes(${axisNum})`;
    if (options.title !== undefined) {
      axisScript += `
$axis.HasTitle = $true
$axis.AxisTitle.Text = '${options.title.replace(/'/g, "''")}'`;
    }
    if (options.min !== undefined) {
      axisScript += `
$axis.MinimumScale = ${options.min}`;
    }
    if (options.max !== undefined) {
      axisScript += `
$axis.MaximumScale = ${options.max}`;
    }
    if (options.majorUnit !== undefined) {
      axisScript += `
$axis.MajorUnit = ${options.majorUnit}`;
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$chartObj = $sheet.ChartObjects(${chartIndex})
$chart = $chartObj.Chart
${axisScript}
@{ success = $true; message = "Chart ${axisType}-axis updated" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Cell Lock
  // -------------------------------------------------------------------------

  async excelLockCells(range: string, lock: boolean = true, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';
    const lockValue = lock ? '$true' : '$false';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$sheet.Range('${range}').Locked = ${lockValue}
@{ success = $true; message = "Cells ${range} ${lock ? 'locked' : 'unlocked'}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Get Used Range
  // -------------------------------------------------------------------------

  async excelGetUsedRange(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$usedRange = $sheet.UsedRange
$address = $usedRange.Address
$rows = $usedRange.Rows.Count
$cols = $usedRange.Columns.Count
$firstRow = $usedRange.Row
$firstCol = $usedRange.Column
@{
  success = $true
  range = $address
  rows = $rows
  columns = $cols
  first_row = $firstRow
  first_column = $firstCol
} | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Autofit Range
  // -------------------------------------------------------------------------

  async excelAutofitRange(range: string, fitColumns: boolean = true, fitRows: boolean = false, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    const fitScript: string[] = [];
    if (fitColumns) fitScript.push('$range.Columns.AutoFit() | Out-Null');
    if (fitRows) fitScript.push('$range.Rows.AutoFit() | Out-Null');

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${range}')
${fitScript.join('\n')}
@{ success = $true; message = "Autofit applied to ${range}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Remove Duplicates
  // -------------------------------------------------------------------------

  async excelRemoveDuplicates(range: string, columns?: number[], hasHeader: boolean = true, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';
    const header = hasHeader ? 1 : 2; // xlYes = 1, xlNo = 2

    // If columns not specified, use all columns
    const columnsScript = columns && columns.length > 0
      ? `$columns = @(${columns.join(',')})`
      : `$columns = @(1..$range.Columns.Count)`;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$range = $sheet.Range('${range}')
$beforeCount = $range.Rows.Count
${columnsScript}
$range.RemoveDuplicates($columns, ${header})
$afterCount = $sheet.Range('${range}').Rows.Count
$removed = $beforeCount - $afterCount
@{ success = $true; message = "$removed duplicate rows removed"; rows_removed = $removed } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Excel Get Charts
  // -------------------------------------------------------------------------

  async excelGetCharts(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $excel.ActiveWorkbook.Worksheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $excel.ActiveWorkbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
${sheetScript}
$charts = @()
$index = 1
foreach ($chartObj in $sheet.ChartObjects()) {
  $chart = $chartObj.Chart
  $charts += @{
    index = $index
    name = $chartObj.Name
    chart_type = $chart.ChartType
    has_title = $chart.HasTitle
    title = if ($chart.HasTitle) { $chart.ChartTitle.Text } else { $null }
    left = $chartObj.Left
    top = $chartObj.Top
    width = $chartObj.Width
    height = $chartObj.Height
    series_count = $chart.SeriesCollection().Count
  }
  $index++
}
@{ success = $true; charts = $charts; count = $charts.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  // ===========================================================================
  // Excel Table (ListObject) Operations
  // ===========================================================================

  async excelCreateTable(
    range: string,
    tableName: string,
    hasHeaders: boolean = true,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const xlSrcRange = 1; // xlSrcRange
    const xlYes = 1; // xlYes
    const xlNo = 2; // xlNo
    const headerOption = hasHeaders ? xlYes : xlNo;

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$table = $sheet.ListObjects.Add(${xlSrcRange}, $range, $null, ${headerOption})
$table.Name = '${tableName.replace(/'/g, "''")}'
$table.TableStyle = 'TableStyleMedium2'
@{ success = $true; message = "Table '${tableName}' created"; table_name = $table.Name; range = '${range}' } | ConvertTo-Json -Compress
`);
  }

  async excelDeleteTable(tableName: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$table = $sheet.ListObjects('${tableName.replace(/'/g, "''")}')
$table.Delete()
@{ success = $true; message = "Table '${tableName}' deleted" } | ConvertTo-Json -Compress
`);
  }

  async excelGetTables(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$tables = @()
foreach ($table in $sheet.ListObjects) {
  $tables += @{
    name = $table.Name
    range = $table.Range.Address()
    row_count = $table.ListRows.Count
    column_count = $table.ListColumns.Count
    has_headers = $table.ShowHeaders
    style = $table.TableStyle.Name
  }
}
@{ success = $true; tables = $tables; count = $tables.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async excelAddTableColumn(
    tableName: string,
    columnName: string,
    formula?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    const formulaScript = formula
      ? `$newCol.DataBodyRange.Formula = '${formula.replace(/'/g, "''")}'`
      : '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$table = $sheet.ListObjects('${tableName.replace(/'/g, "''")}')
$newCol = $table.ListColumns.Add()
$newCol.Name = '${columnName.replace(/'/g, "''")}'
${formulaScript}
@{ success = $true; message = "Column '${columnName}' added to table '${tableName}'"; column_index = $newCol.Index } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Excel Page Setup & Print Operations
  // ===========================================================================

  async excelSetPageSetup(
    options: {
      orientation?: 'portrait' | 'landscape';
      paperSize?: 'letter' | 'legal' | 'a4' | 'a3';
      margins?: { top?: number; bottom?: number; left?: number; right?: number };
      fitToPage?: boolean;
      fitToWidth?: number;
      fitToHeight?: number;
    },
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    const orientationMap: Record<string, number> = {
      portrait: 1,   // xlPortrait
      landscape: 2,  // xlLandscape
    };
    const paperSizeMap: Record<string, number> = {
      letter: 1,  // xlPaperLetter
      legal: 5,   // xlPaperLegal
      a4: 9,      // xlPaperA4
      a3: 8,      // xlPaperA3
    };

    const commands: string[] = [];
    if (options.orientation) {
      commands.push(`$ps.Orientation = ${orientationMap[options.orientation]}`);
    }
    if (options.paperSize) {
      commands.push(`$ps.PaperSize = ${paperSizeMap[options.paperSize]}`);
    }
    if (options.margins) {
      if (options.margins.top !== undefined) commands.push(`$ps.TopMargin = $excel.InchesToPoints(${options.margins.top})`);
      if (options.margins.bottom !== undefined) commands.push(`$ps.BottomMargin = $excel.InchesToPoints(${options.margins.bottom})`);
      if (options.margins.left !== undefined) commands.push(`$ps.LeftMargin = $excel.InchesToPoints(${options.margins.left})`);
      if (options.margins.right !== undefined) commands.push(`$ps.RightMargin = $excel.InchesToPoints(${options.margins.right})`);
    }
    if (options.fitToPage) {
      commands.push('$ps.Zoom = $false');
      commands.push(`$ps.FitToPagesWide = ${options.fitToWidth ?? 1}`);
      commands.push(`$ps.FitToPagesTall = ${options.fitToHeight ?? 1}`);
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$ps = $sheet.PageSetup
${commands.join('\n')}
@{ success = $true; message = "Page setup configured" } | ConvertTo-Json -Compress
`);
  }

  async excelSetPrintArea(range: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.PageSetup.PrintArea = '${range}'
@{ success = $true; message = "Print area set to '${range}'" } | ConvertTo-Json -Compress
`);
  }

  async excelSetPrintTitles(
    rowsToRepeat?: string,
    columnsToRepeat?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    const commands: string[] = [];
    if (rowsToRepeat) {
      commands.push(`$sheet.PageSetup.PrintTitleRows = '${rowsToRepeat}'`);
    }
    if (columnsToRepeat) {
      commands.push(`$sheet.PageSetup.PrintTitleColumns = '${columnsToRepeat}'`);
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
${commands.join('\n')}
@{ success = $true; message = "Print titles configured"; rows = '${rowsToRepeat || ''}'; columns = '${columnsToRepeat || ''}' } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Excel Array Formula & Advanced Operations
  // ===========================================================================

  async excelInsertArrayFormula(
    range: string,
    formula: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$range.FormulaArray = '${formula.replace(/'/g, "''")}'
@{ success = $true; message = "Array formula inserted in '${range}'" } | ConvertTo-Json -Compress
`);
  }

  async excelTranspose(sourceRange: string, destCell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$srcRange = $sheet.Range('${sourceRange}')
$values = $srcRange.Value2
$transposed = $excel.WorksheetFunction.Transpose($values)
$rows = $srcRange.Columns.Count
$cols = $srcRange.Rows.Count
$destStart = $sheet.Range('${destCell}')
$destEnd = $sheet.Cells($destStart.Row + $rows - 1, $destStart.Column + $cols - 1)
$destRange = $sheet.Range($destStart, $destEnd)
$destRange.Value = $transposed
@{ success = $true; message = "Transposed '${sourceRange}' to '${destCell}'"; new_size = "$rows x $cols" } | ConvertTo-Json -Compress
`);
  }

  async excelTextToColumns(
    range: string,
    delimiter: 'comma' | 'tab' | 'semicolon' | 'space' | string,
    destCell?: string,
    sheet?: string
  ): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // Delimiter constants
    const delimiterMap: Record<string, string> = {
      comma: '$true, $false, $false, $false, $false',     // Comma=true
      tab: '$false, $false, $false, $true, $false',       // Tab=true
      semicolon: '$false, $true, $false, $false, $false', // Semicolon=true
      space: '$false, $false, $false, $false, $true',     // Space=true
    };

    const delimiterArgs = delimiterMap[delimiter] || '$false, $false, $false, $false, $false';
    const otherDelim = delimiterMap[delimiter] ? '' : `, $false, '${delimiter}'`;
    const destScript = destCell ? `$sheet.Range('${destCell}')` : '$srcRange';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$srcRange = $sheet.Range('${range}')
$srcRange.TextToColumns(${destScript}, 1, 1, $false, ${delimiterArgs}${otherDelim})
@{ success = $true; message = "Text to columns applied to '${range}'" } | ConvertTo-Json -Compress
`);
  }

  async excelHideSheet(sheetName: string): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$sheet = $workbook.Sheets('${sheetName.replace(/'/g, "''")}')
$sheet.Visible = 0  # xlSheetHidden
@{ success = $true; message = "Sheet '${sheetName}' hidden" } | ConvertTo-Json -Compress
`);
  }

  async excelShowSheet(sheetName: string): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$sheet = $workbook.Sheets('${sheetName.replace(/'/g, "''")}')
$sheet.Visible = -1  # xlSheetVisible
@{ success = $true; message = "Sheet '${sheetName}' shown" } | ConvertTo-Json -Compress
`);
  }

  async excelSetTabColor(sheetName: string, color: string): Promise<OfficeResponse> {
    // Convert hex color to RGB values
    const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!result || !result[1] || !result[2] || !result[3]) return null;
      return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      };
    };

    const rgb = hexToRgb(color);
    if (!rgb) {
      return { success: false, error: `Invalid hex color: ${color}` };
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$sheet = $workbook.Sheets('${sheetName.replace(/'/g, "''")}')
$sheet.Tab.Color = [System.Drawing.ColorTranslator]::ToOle([System.Drawing.Color]::FromArgb(${rgb.r}, ${rgb.g}, ${rgb.b}))
@{ success = $true; message = "Tab color set for '${sheetName}'" } | ConvertTo-Json -Compress
`);
  }

  async excelSetZoom(zoomLevel: number, sheet?: string): Promise<OfficeResponse> {
    if (zoomLevel < 10 || zoomLevel > 400) {
      return { success: false, error: `Invalid zoom level: ${zoomLevel}. Must be between 10 and 400.` };
    }

    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}'); $sheet.Activate()` :
      '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$excel.ActiveWindow.Zoom = ${zoomLevel}
@{ success = $true; message = "Zoom set to ${zoomLevel}%" } | ConvertTo-Json -Compress
`);
  }

  async excelSetGridlines(show: boolean, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}'); $sheet.Activate()` :
      '';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$excel.ActiveWindow.DisplayGridlines = ${show ? '$true' : '$false'}
@{ success = $true; message = "Gridlines ${show ? 'shown' : 'hidden'}" } | ConvertTo-Json -Compress
`);
  }

  async excelSetViewMode(mode: 'normal' | 'pageBreak' | 'pageLayout', sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}'); $sheet.Activate()` :
      '';

    // xlNormalView = 1, xlPageBreakPreview = 2, xlPageLayoutView = 3
    const modeMap: Record<string, number> = {
      normal: 1,
      pageBreak: 2,
      pageLayout: 3,
    };

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$excel.ActiveWindow.View = ${modeMap[mode]}
@{ success = $true; message = "View mode set to '${mode}'" } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Excel Import/Export Operations
  // ===========================================================================

  async excelExportCsv(filePath: string, sheet?: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$tempWorkbook = $excel.Workbooks.Add()
$sheet.Copy($tempWorkbook.Sheets(1))
$tempWorkbook.Sheets(1).Delete()
$tempWorkbook.SaveAs('${windowsPath}', 6)  # xlCSV = 6
$tempWorkbook.Close($false)
@{ success = $true; message = "Exported to CSV"; path = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  async excelExportJson(range: string, filePath: string, sheet?: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Range('${range}')
$values = $range.Value2
$rows = $range.Rows.Count
$cols = $range.Columns.Count

# Get headers from first row
$headers = @()
for ($c = 1; $c -le $cols; $c++) {
  $headers += $values[1, $c]
}

# Build JSON array
$jsonArray = @()
for ($r = 2; $r -le $rows; $r++) {
  $obj = @{}
  for ($c = 1; $c -le $cols; $c++) {
    $obj[$headers[$c-1]] = $values[$r, $c]
  }
  $jsonArray += $obj
}

$json = $jsonArray | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText('${windowsPath}', $json, [System.Text.Encoding]::UTF8)
@{ success = $true; message = "Exported to JSON"; path = '${windowsPath}'; rows = ($rows - 1) } | ConvertTo-Json -Compress
`);
  }

  async excelImportCsv(
    filePath: string,
    destCell: string,
    delimiter: string = ',',
    sheet?: string
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    const textQualifier = 1; // xlTextQualifierDoubleQuote

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$destRange = $sheet.Range('${destCell}')
$qt = $sheet.QueryTables.Add("TEXT;${windowsPath}", $destRange)
$qt.TextFileParseType = 1  # xlDelimited
$qt.TextFileCommaDelimiter = ${delimiter === ',' ? '$true' : '$false'}
$qt.TextFileTabDelimiter = ${delimiter === '\t' ? '$true' : '$false'}
$qt.TextFileSemicolonDelimiter = ${delimiter === ';' ? '$true' : '$false'}
$qt.TextFileSpaceDelimiter = ${delimiter === ' ' ? '$true' : '$false'}
$qt.TextFileTextQualifier = ${textQualifier}
$qt.Refresh($false)
$qt.Delete()
@{ success = $true; message = "CSV imported to ${destCell}"; source = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Excel Image & Comment Operations
  // ===========================================================================

  async excelRemoveImage(imageName: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$shape = $sheet.Shapes('${imageName.replace(/'/g, "''")}')
$shape.Delete()
@{ success = $true; message = "Image '${imageName}' removed" } | ConvertTo-Json -Compress
`);
  }

  async excelGetImages(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$images = @()
foreach ($shape in $sheet.Shapes) {
  if ($shape.Type -eq 13) {  # msoPicture
    $images += @{
      name = $shape.Name
      left = $shape.Left
      top = $shape.Top
      width = $shape.Width
      height = $shape.Height
    }
  }
}
@{ success = $true; images = $images; count = $images.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async excelEditComment(cell: string, newText: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(newText);

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$cell = $sheet.Range('${cell}')
if ($cell.Comment -eq $null) {
  @{ success = $false; error = "No comment exists in cell ${cell}" } | ConvertTo-Json -Compress
} else {
  $cell.Comment.Text('${newText.replace(/'/g, "''")}')
  ${hasKorean ? "$cell.Comment.Shape.TextFrame.Characters().Font.Name = 'Malgun Gothic'" : ''}
  @{ success = $true; message = "Comment updated in ${cell}" } | ConvertTo-Json -Compress
}
`);
  }

  // ===========================================================================
  // Excel Pivot & Calculation Operations
  // ===========================================================================

  async excelDeletePivotField(tableName: string, fieldName: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$pivotTable = $sheet.PivotTables('${tableName.replace(/'/g, "''")}')
$field = $pivotTable.PivotFields('${fieldName.replace(/'/g, "''")}')
$field.Orientation = 0  # xlHidden
@{ success = $true; message = "Field '${fieldName}' removed from pivot table '${tableName}'" } | ConvertTo-Json -Compress
`);
  }

  async excelSetCalculationMode(mode: 'automatic' | 'manual' | 'semiautomatic'): Promise<OfficeResponse> {
    const modeMap: Record<string, number> = {
      automatic: -4105,      // xlCalculationAutomatic
      manual: -4135,         // xlCalculationManual
      semiautomatic: 2,      // xlCalculationSemiautomatic
    };

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$excel.Calculation = ${modeMap[mode]}
@{ success = $true; message = "Calculation mode set to '${mode}'" } | ConvertTo-Json -Compress
`);
  }

  async excelRecalculate(scope: 'workbook' | 'sheet' | 'range', range?: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    let calcScript = '';
    switch (scope) {
      case 'workbook':
        calcScript = '$excel.CalculateFull()';
        break;
      case 'sheet':
        calcScript = `${sheetScript}\n$sheet.Calculate()`;
        break;
      case 'range':
        calcScript = `${sheetScript}\n$sheet.Range('${range}').Calculate()`;
        break;
    }

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${calcScript}
@{ success = $true; message = "Recalculated ${scope}" } | ConvertTo-Json -Compress
`);
  }

  async excelTracePrecedents(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$cell = $sheet.Range('${cell}')
$cell.ShowPrecedents()
@{ success = $true; message = "Showing precedents for ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelTraceDependents(cell: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$cell = $sheet.Range('${cell}')
$cell.ShowDependents()
@{ success = $true; message = "Showing dependents for ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelClearArrows(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
$workbook.ActiveSheet.ClearArrows()
@{ success = $true; message = "Cleared all arrows" } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Column Grouping Operations
  // ===========================================================================

  async excelGroupColumns(startCol: string, endCol: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Columns("${startCol}:${endCol}")
$range.Group()
@{ success = $true; message = "Grouped columns ${startCol} to ${endCol}" } | ConvertTo-Json -Compress
`);
  }

  async excelUngroupColumns(startCol: string, endCol: string, sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$range = $sheet.Columns("${startCol}:${endCol}")
$range.Ungroup()
@{ success = $true; message = "Ungrouped columns ${startCol} to ${endCol}" } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Page Break Operations
  // ===========================================================================

  async excelInsertPageBreak(cell: string, type: 'row' | 'column', sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // xlPageBreakManual = -4135
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$cell = $sheet.Range("${cell}")
$cell.PageBreak = -4135
@{ success = $true; message = "Inserted ${type} page break at ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelDeletePageBreak(cell: string, type: 'row' | 'column', sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    // xlPageBreakNone = -4142
    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$cell = $sheet.Range("${cell}")
$cell.PageBreak = -4142
@{ success = $true; message = "Deleted ${type} page break at ${cell}" } | ConvertTo-Json -Compress
`);
  }

  async excelResetAllPageBreaks(sheet?: string): Promise<OfficeResponse> {
    const sheetScript = sheet ?
      `$sheet = $workbook.Sheets('${sheet.replace(/'/g, "''")}')` :
      '$sheet = $workbook.ActiveSheet';

    return this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$workbook = $excel.ActiveWorkbook
${sheetScript}
$sheet.ResetAllPageBreaks()
@{ success = $true; message = "Reset all page breaks" } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Microsoft PowerPoint Operations
  // ===========================================================================

  // ===========================================================================
  // Workbook Validation (for Create Agent pre-save check)
  // ===========================================================================

  /**
   * Get the bottom position (in points) of the used range on a sheet.
   * Used by chart builder to place charts below data without overlap.
   */
  async getUsedRangeBottom(sheetName: string): Promise<number> {
    try {
      const result = await this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$ws = $excel.ActiveWorkbook.Worksheets('${sheetName.replace(/'/g, "''")}')
$ur = $ws.UsedRange
$lastRow = $ur.Row + $ur.Rows.Count - 1
$bottom = $ws.Rows($lastRow).Top + $ws.Rows($lastRow).Height
@{ success = $true; bottom = [math]::Round($bottom, 1) } | ConvertTo-Json -Compress
`);
      if (result.success && 'bottom' in result) {
        const bottom = (result as Record<string, unknown>)['bottom'];
        return typeof bottom === 'number' ? bottom : 300;
      }
      return 300;
    } catch {
      return 300;
    }
  }

  async validateWorkbook(): Promise<{ valid: boolean; issues: string[] }> {
    try {
      const result = await this.executePowerShell(`
$excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
$wb = $excel.ActiveWorkbook
$issues = @()
$sheetCount = $wb.Sheets.Count
# Note: 1 sheet is valid when user explicitly requests single sheet
for ($s=1; $s -le $sheetCount; $s++) {
  $ws = $wb.Sheets.Item($s)
  $sn = $ws.Name
  try {
    $ur = $ws.UsedRange
    $dataRows = $ur.Rows.Count
    $dataCols = $ur.Columns.Count
    if ($dataRows -lt 4) { $issues += "Sheet '$sn' has only $($dataRows - 2) data row(s) (need at least 2). Add more rows with excel_build_data_sheet." }
    if ($dataCols -lt 4) { $issues += "Sheet '$sn' has only $dataCols column(s) (need at least 4). Add formula columns with excel_build_formula_columns." }
    # Empty row check removed — prompt guidance is sufficient, hard blocking causes save failures
  } catch { $issues += "Sheet '$sn' appears empty. Build data with excel_build_data_sheet." }
  try {
    $charts = $ws.ChartObjects().Count
    if ($charts -eq 0) { $issues += "Sheet '$sn' has no charts. Call excel_build_chart." }
  } catch { $issues += "Sheet '$sn' has no charts. Call excel_build_chart." }
  try {
    $cfCount = $ws.UsedRange.FormatConditions.Count
    if ($cfCount -eq 0) { $issues += "Sheet '$sn' has no conditional formatting. Call excel_build_conditional_format with rule_type cellValue AND colorScale." }
    elseif ($cfCount -lt 1) { $issues += "Sheet '$sn' has only $cfCount conditional format rule(s). Need at least 1: call excel_build_conditional_format (rule_type cellValue or colorScale)." }
  } catch { $issues += "Sheet '$sn' has no conditional formatting. Call excel_build_conditional_format with rule_type cellValue AND colorScale." }
}
@{ success = $true; valid = ($issues.Count -eq 0); issues = $issues } | ConvertTo-Json -Compress
`);
      if (result.success && 'valid' in result) {
        return {
          valid: !!(result as Record<string, unknown>)['valid'],
          issues: ((result as Record<string, unknown>)['issues'] as string[]) || [],
        };
      }
      return { valid: true, issues: [] };
    } catch {
      return { valid: true, issues: [] }; // On error, allow save
    }
  }

}

// Export singleton instance
export const excelClient = new ExcelClient();
export type { OfficeResponse, ScreenshotResponse };

