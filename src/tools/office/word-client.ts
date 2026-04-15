/**
 * Word Client
 *
 * Microsoft Word automation via PowerShell COM.
 * Extends OfficeClientBase with Word-specific operations.
 */

import { OfficeClientBase, OfficeResponse, ScreenshotResponse } from './office-client-base.js';

export class WordClient extends OfficeClientBase {
  protected override comProgId = 'Word.Application';
  protected override displayAlertsSuppressExpr = '0';  // wdAlertsNone = 0

  // ===========================================================================
  // Microsoft Word Operations
  // ===========================================================================

  async wordLaunch(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
  $word.Visible = -1  # msoTrue
  @{ success = $true; message = "Connected to existing Word instance" } | ConvertTo-Json -Compress
} catch {
  $word = New-Object -ComObject Word.Application
  $word.Visible = -1  # msoTrue
  @{ success = $true; message = "Launched new Word instance" } | ConvertTo-Json -Compress
}
`);
  }

  async wordCreate(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
} catch {
  $word = New-Object -ComObject Word.Application
}
$word.DisplayAlerts = 0
$word.Visible = -1  # msoTrue
$doc = $word.Documents.Add()
$word.DisplayAlerts = -1
@{ success = $true; message = "Created new document"; document_name = $doc.Name } | ConvertTo-Json -Compress
`);
  }

  async wordWrite(
    text: string,
    options?: {
      fontName?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      newParagraph?: boolean;
      color?: string;
      alignment?: 'left' | 'center' | 'right' | 'justify';
      spaceBefore?: number;
      spaceAfter?: number;
      lineSpacing?: number;
      styleName?: string;
      bgColor?: string;
      leftBorderColor?: string;
      leftBorderWidth?: number;
      keepWithNext?: boolean;
    }
  ): Promise<OfficeResponse> {
    // Auto-detect Korean text and set appropriate font if not specified
    // Use 'Malgun Gothic' (English name) for compatibility with all Windows language settings
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    let fontName = options?.fontName?.replace(/'/g, "''") || '';
    if (!fontName && hasKorean) {
      fontName = 'Malgun Gothic'; // Korean font (works on all Windows regardless of UI language)
    }

    const fontSize = options?.fontSize || 0;
    const bold = options?.bold ? '$true' : '$false';
    const italic = options?.italic ? '$true' : '$false';
    // Default to true: add paragraph break after writing (prevents formatting bleed)
    const newParagraph = options?.newParagraph !== false;

    // For Korean text, use Base64 encoding to prevent encoding issues
    // Split text by \n (both literal \n and actual newline) and generate TypeText + TypeParagraph
    const lines = text.split(/\\n|\n/);
    const typeCommands = lines.map((line, index) => {
      const isLastLine = index === lines.length - 1;
      // Use Base64 encoding for safe Unicode/Korean transfer
      const base64Line = this.encodeTextForPowerShell(line);
      const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Line}'))`;

      if (isLastLine && !newParagraph) {
        return `$selection.TypeText(${decodeExpr})`;
      } else {
        return `$selection.TypeText(${decodeExpr})\n$selection.TypeParagraph()`;
      }
    }).join('\n');

    // Post-write formatting commands (applied to typed range)
    const postFormatCmds: string[] = [];

    // Apply paragraph style FIRST (before font overrides)
    // Use wdStyle constants for locale-independent style application
    if (options?.styleName) {
      const styleIdMap: Record<string, number> = {
        'Normal': -1, 'Heading 1': -2, 'Heading 2': -3, 'Heading 3': -4,
        'Heading 4': -5, 'Heading 5': -6,
      };
      const styleId = styleIdMap[options.styleName];
      if (styleId !== undefined) {
        postFormatCmds.push(`$typedRange.Style = $doc.Styles.Item(${styleId})`);
      } else {
        const escapedStyle = options.styleName.replace(/'/g, "''");
        postFormatCmds.push(`$typedRange.Style = '${escapedStyle}'`);
      }
    }

    // Font color
    if (options?.color) {
      const hex = options.color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const rgb = r + g * 256 + b * 65536;
      postFormatCmds.push(`$typedRange.Font.Color = ${rgb}`);
    }

    // Paragraph alignment: 0=left, 1=center, 2=right, 3=justify
    const alignMap: Record<string, number> = { left: 0, center: 1, right: 2, justify: 3 };
    if (options?.alignment) {
      postFormatCmds.push(`$typedRange.ParagraphFormat.Alignment = ${alignMap[options.alignment]}`);
    }

    // Paragraph spacing
    if (options?.spaceBefore != null) {
      postFormatCmds.push(`$typedRange.ParagraphFormat.SpaceBefore = ${options.spaceBefore}`);
    }
    if (options?.spaceAfter != null) {
      postFormatCmds.push(`$typedRange.ParagraphFormat.SpaceAfter = ${options.spaceAfter}`);
    }

    // Line spacing (multiplier: 1.0, 1.3, 1.5, etc.)
    if (options?.lineSpacing) {
      postFormatCmds.push(`$typedRange.ParagraphFormat.LineSpacingRule = 5`); // wdLineSpaceMultiple
      postFormatCmds.push(`$typedRange.ParagraphFormat.LineSpacing = ${options.lineSpacing * 12}`);
    }

    // Paragraph background shading
    if (options?.bgColor) {
      const bgHex = options.bgColor.replace('#', '');
      const bgR = parseInt(bgHex.substring(0, 2), 16);
      const bgG = parseInt(bgHex.substring(2, 4), 16);
      const bgB = parseInt(bgHex.substring(4, 6), 16);
      postFormatCmds.push(`$typedRange.Shading.BackgroundPatternColor = ${bgR + bgG * 256 + bgB * 65536}`);
    }

    // Left border accent
    if (options?.leftBorderColor) {
      const lbHex = options.leftBorderColor.replace('#', '');
      const lbR = parseInt(lbHex.substring(0, 2), 16);
      const lbG = parseInt(lbHex.substring(2, 4), 16);
      const lbB = parseInt(lbHex.substring(4, 6), 16);
      const lbWidth = (options.leftBorderWidth || 3) * 8; // pt to Word enum
      postFormatCmds.push(`$typedRange.ParagraphFormat.Borders(-2).LineStyle = 1`); // wdBorderLeft, wdLineStyleSingle
      postFormatCmds.push(`$typedRange.ParagraphFormat.Borders(-2).LineWidth = ${lbWidth}`);
      postFormatCmds.push(`$typedRange.ParagraphFormat.Borders(-2).Color = ${lbR + lbG * 256 + lbB * 65536}`);
      postFormatCmds.push(`$typedRange.ParagraphFormat.LeftIndent = 8`);
    }

    // Keep paragraph with next (prevents orphaned headings at page bottom)
    if (options?.keepWithNext) {
      postFormatCmds.push(`$typedRange.ParagraphFormat.KeepWithNext = $true`);
      postFormatCmds.push(`$typedRange.ParagraphFormat.KeepTogether = $true`);
    }

    // Set font BEFORE typing, then apply style+font to typed range AFTER
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection

# Remember start position
$startPos = $selection.Range.Start

# Set all formatting BEFORE typing (including East Asian font for Korean)
${fontSize ? `$selection.Font.Size = ${fontSize}` : ''}
$selection.Font.Bold = ${bold}
$selection.Font.Italic = ${italic}
${fontName ? `$selection.Font.Name = '${fontName}'\n$selection.Font.NameFarEast = '${fontName}'` : ''}

# Type text (decoded from Base64 for Unicode safety)
${typeCommands}

# Apply style, font, and paragraph formatting to the typed range
$endPos = $selection.Range.End
$typedRange = $doc.Range($startPos, $endPos)
${postFormatCmds.join('\n')}
${fontName ? `$typedRange.Font.Name = '${fontName}'\n$typedRange.Font.NameFarEast = '${fontName}'` : ''}

@{ success = $true; message = "Text written successfully" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Build a professional cover page design using shapes and textboxes.
   * Creates a colored banner, accent strip, title, subtitle, date/author, and bottom bar.
   * All elements are floating shapes positioned relative to the page edges.
   */
  async wordBuildCoverDesign(options: {
    title: string;
    subtitle?: string;
    dateText?: string;
    author?: string;
    primaryColor: string;
    accentColor: string;
    fontTitle?: string;
    fontBody?: string;
  }): Promise<OfficeResponse> {
    // Base64 encode for safe Unicode/Korean transfer in PowerShell
    const b64Title = this.encodeTextForPowerShell(options.title);
    const b64Subtitle = this.encodeTextForPowerShell(options.subtitle || '');
    const b64Date = this.encodeTextForPowerShell(options.dateText || '');
    const b64Author = this.encodeTextForPowerShell(options.author || '');

    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(options.title + (options.subtitle || ''));
    const titleFont = (options.fontTitle || (hasKorean ? 'Malgun Gothic' : 'Segoe UI')).replace(/'/g, "''");
    const bodyFont = (options.fontBody || (hasKorean ? 'Malgun Gothic' : 'Segoe UI')).replace(/'/g, "''");

    const primaryRgb = this.hexToRgb(options.primaryColor);
    const accentRgb = this.hexToRgb(options.accentColor);
    if (!primaryRgb || !accentRgb) {
      return { success: false, error: 'Invalid color hex values' } as OfficeResponse;
    }
    const primaryWd = primaryRgb.r + primaryRgb.g * 256 + primaryRgb.b * 65536;
    const accentWd = accentRgb.r + accentRgb.g * 256 + accentRgb.b * 65536;

    const hasSubtitle = !!options.subtitle;
    const hasInfo = !!options.dateText || !!options.author;

    const subtitleBlock = hasSubtitle ? `
$sY = $tY + 90
$st = $doc.Shapes.AddTextbox(1, 80, $sY, ($pgW - 160), 50, $anchor)
$st.LockAnchor = -1
$st.WrapFormat.Type = 3
$st.RelativeHorizontalPosition = 1
$st.RelativeVerticalPosition = 1
$st.Left = 80
$st.Top = $sY
$st.Width = $pgW - 160
$st.Height = 50
$st.TextFrame.TextRange.Text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Subtitle}'))
$st.TextFrame.TextRange.Font.Name = '${bodyFont}'
$st.TextFrame.TextRange.Font.Size = 14
$st.TextFrame.TextRange.Font.Color = 14540253
$st.TextFrame.TextRange.ParagraphFormat.Alignment = 1
$st.Fill.Visible = 0
$st.Line.Visible = 0` : '';

    const infoLines: string[] = [];
    if (options.dateText) infoLines.push(`$infoText += [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Date}'))`);
    if (options.dateText && options.author) infoLines.push(`$infoText += [char]13`);
    if (options.author) infoLines.push(`$infoText += [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Author}'))`);

    const infoBlock = hasInfo ? `
$iY = $bH + 30
$info = $doc.Shapes.AddTextbox(1, 80, $iY, ($pgW - 160), 55, $anchor)
$info.LockAnchor = -1
$info.WrapFormat.Type = 3
$info.RelativeHorizontalPosition = 1
$info.RelativeVerticalPosition = 1
$info.Left = 80
$info.Top = $iY
$info.Width = $pgW - 160
$info.Height = 55
$infoText = ''
${infoLines.join('\n')}
$info.TextFrame.TextRange.Text = $infoText
$info.TextFrame.TextRange.Font.Name = '${bodyFont}'
$info.TextFrame.TextRange.Font.Size = 11
$info.TextFrame.TextRange.Font.Color = 8421504
$info.TextFrame.TextRange.ParagraphFormat.Alignment = 1
$info.Fill.Visible = 0
$info.Line.Visible = 0` : '';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$word.Selection.HomeKey(6)  # wdStory — ensure cursor at document start
$pgW = $doc.PageSetup.PageWidth
$pgH = $doc.PageSetup.PageHeight
$anchor = $doc.Range(0, 0)  # anchor all shapes to first paragraph

# 1. Primary color banner (top 40%)
$bH = [math]::Round($pgH * 0.40)
$b = $doc.Shapes.AddShape(1, 0, 0, 10, 10, $anchor)
$b.LockAnchor = -1
$b.WrapFormat.Type = 3
$b.RelativeHorizontalPosition = 1
$b.RelativeVerticalPosition = 1
$b.Left = 0
$b.Top = 0
$b.Width = $pgW
$b.Height = $bH
$b.Fill.Visible = -1
$b.Fill.Solid()
$b.Fill.ForeColor.RGB = ${primaryWd}
$b.Line.Visible = 0

# 2. Accent strip below banner
$s = $doc.Shapes.AddShape(1, 0, 0, 10, 10, $anchor)
$s.LockAnchor = -1
$s.WrapFormat.Type = 3
$s.RelativeHorizontalPosition = 1
$s.RelativeVerticalPosition = 1
$s.Left = 0
$s.Top = $bH
$s.Width = $pgW
$s.Height = 5
$s.Fill.Visible = -1
$s.Fill.Solid()
$s.Fill.ForeColor.RGB = ${accentWd}
$s.Line.Visible = 0

# 3. Title textbox (white text on dark banner)
$tY = [math]::Round($bH * 0.32)
$t = $doc.Shapes.AddTextbox(1, 50, $tY, ($pgW - 100), 80, $anchor)
$t.LockAnchor = -1
$t.WrapFormat.Type = 3
$t.RelativeHorizontalPosition = 1
$t.RelativeVerticalPosition = 1
$t.Left = 50
$t.Top = $tY
$t.Width = $pgW - 100
$t.Height = 80
$t.TextFrame.TextRange.Text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Title}'))
$t.TextFrame.TextRange.Font.Name = '${titleFont}'
$t.TextFrame.TextRange.Font.Size = 36
$t.TextFrame.TextRange.Font.Bold = -1
$t.TextFrame.TextRange.Font.Color = 16777215
$t.TextFrame.TextRange.ParagraphFormat.Alignment = 1
$t.TextFrame.MarginLeft = 10
$t.TextFrame.MarginRight = 10
$t.Fill.Visible = 0
$t.Line.Visible = 0
${subtitleBlock}
${infoBlock}

# 4. Bottom accent bar
$bb = $doc.Shapes.AddShape(1, 0, 0, 10, 10, $anchor)
$bb.LockAnchor = -1
$bb.WrapFormat.Type = 3
$bb.RelativeHorizontalPosition = 1
$bb.RelativeVerticalPosition = 1
$bb.Left = 0
$bb.Top = $pgH - 10
$bb.Width = $pgW
$bb.Height = 10
$bb.Fill.Visible = -1
$bb.Fill.Solid()
$bb.Fill.ForeColor.RGB = ${accentWd}
$bb.Line.Visible = 0

@{ success = $true; message = "Cover design created" } | ConvertTo-Json -Compress
`);
  }

  async wordRead(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$content = $doc.Content.Text
@{
  success = $true
  document_name = $doc.Name
  content = $content
  character_count = $content.Length
} | ConvertTo-Json -Compress
`);
  }

  async wordSave(filePath?: string): Promise<OfficeResponse> {
    const windowsPath = filePath ? this.toWindowsPath(filePath).replace(/'/g, "''") : '';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument

# Update all Tables of Contents before saving
foreach ($toc in $doc.TablesOfContents) {
  try { $toc.Update() } catch {}
}
foreach ($field in $doc.Fields) {
  try { $field.Update() } catch {}
}

${windowsPath ? `$doc.SaveAs([ref]'${windowsPath}')` : '$doc.Save()'}
@{ success = $true; message = "Document saved"; path = $doc.FullName } | ConvertTo-Json -Compress
`);
  }

  async wordOpen(filePath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    return this.executePowerShell(`
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
} catch {
  $word = New-Object -ComObject Word.Application
}
$word.DisplayAlerts = 0
$word.Visible = -1  # msoTrue
$doc = $word.Documents.Open('${windowsPath}')
$word.DisplayAlerts = -1
@{ success = $true; message = "Document opened"; document_name = $doc.Name; path = $doc.FullName } | ConvertTo-Json -Compress
`);
  }

  async wordClose(save: boolean = false): Promise<OfficeResponse> {
    const saveOption = save ? '-1' : '0'; // wdSaveChanges = -1, wdDoNotSaveChanges = 0
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$word.ActiveDocument.Close(${saveOption})
@{ success = $true; message = "Document closed" } | ConvertTo-Json -Compress
`);
  }

  async wordQuit(save: boolean = false): Promise<OfficeResponse> {
    const saveOption = save ? '-1' : '0';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$word.Quit(${saveOption})
@{ success = $true; message = "Word closed" } | ConvertTo-Json -Compress
`);
  }

  async wordSetFont(options: {
    fontName?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
    highlightColor?: string;
  }): Promise<OfficeResponse> {
    const commands: string[] = [];
    if (options.fontName) commands.push(`$selection.Font.Name = '${options.fontName.replace(/'/g, "''")}'`);
    if (options.fontSize) commands.push(`$selection.Font.Size = ${options.fontSize}`);
    if (options.bold !== undefined) commands.push(`$selection.Font.Bold = ${options.bold ? '$true' : '$false'}`);
    if (options.italic !== undefined) commands.push(`$selection.Font.Italic = ${options.italic ? '$true' : '$false'}`);
    if (options.underline !== undefined) commands.push(`$selection.Font.Underline = ${options.underline ? '1' : '0'}`);
    if (options.color) {
      const rgb = this.hexToRgb(options.color);
      if (rgb) commands.push(`$selection.Font.Color = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
    }

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
${commands.join('\n')}
@{ success = $true; message = "Font properties set" } | ConvertTo-Json -Compress
`);
  }

  async wordSetParagraph(options: {
    alignment?: 'left' | 'center' | 'right' | 'justify';
    lineSpacing?: number;
    spaceBefore?: number;
    spaceAfter?: number;
    firstLineIndent?: number;
  }): Promise<OfficeResponse> {
    const alignmentMap: Record<string, number> = { left: 0, center: 1, right: 2, justify: 3 };
    const commands: string[] = [];
    if (options.alignment) commands.push(`$selection.ParagraphFormat.Alignment = ${alignmentMap[options.alignment]}`);
    if (options.lineSpacing) commands.push(`$selection.ParagraphFormat.LineSpacing = ${options.lineSpacing}`);
    if (options.spaceBefore) commands.push(`$selection.ParagraphFormat.SpaceBefore = ${options.spaceBefore}`);
    if (options.spaceAfter) commands.push(`$selection.ParagraphFormat.SpaceAfter = ${options.spaceAfter}`);
    if (options.firstLineIndent) commands.push(`$selection.ParagraphFormat.FirstLineIndent = ${options.firstLineIndent}`);

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
${commands.join('\n')}
@{ success = $true; message = "Paragraph formatting set" } | ConvertTo-Json -Compress
`);
  }

  async wordAddHyperlink(text: string, url: string): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");
    const escapedUrl = url.replace(/'/g, "''");
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$doc = $word.ActiveDocument
$range = $selection.Range
$doc.Hyperlinks.Add($range, '${escapedUrl}', '', '', '${escapedText}')
@{ success = $true; message = "Hyperlink added" } | ConvertTo-Json -Compress
`);
  }

  async wordAddTable(rows: number, cols: number, data?: string[][]): Promise<OfficeResponse> {
    // Auto-adjust dimensions to fit data
    if (data) {
      rows = Math.max(rows, data.length);
      cols = Math.max(cols, ...data.map(row => row?.length || 0));
    }

    let dataScript = '';

    if (data) {
      const dataLines: string[] = [];
      for (let i = 0; i < data.length && i < rows; i++) {
        const row = data[i];
        if (!row) continue;
        for (let j = 0; j < row.length && j < cols; j++) {
          const cellValue = row[j];
          if (cellValue === undefined) continue;
          // Check for Korean text in this specific cell
          const cellHasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(cellValue);
          // Use Base64 encoding for safe Unicode/Korean transfer
          const base64Val = this.encodeTextForPowerShell(cellValue);
          const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Val}'))`;
          // IMPORTANT: Set text FIRST, then apply font (Microsoft's recommended pattern)
          dataLines.push(`$table.Cell(${i + 1}, ${j + 1}).Range.Text = ${decodeExpr}`);
          if (cellHasKorean) {
            dataLines.push(`$table.Cell(${i + 1}, ${j + 1}).Range.Font.Name = 'Malgun Gothic'`);
          }
        }
      }
      dataScript = dataLines.join('\n');
    }

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$range = $word.Selection.Range
$table = $doc.Tables.Add($range, ${rows}, ${cols})
$table.Borders.Enable = $true
# AutoFit to page width for clean layout
$table.AutoFitBehavior(2)  # wdAutoFitWindow = 2
# Set consistent cell formatting for clean appearance
$table.Range.Font.Size = 10
$table.Range.ParagraphFormat.SpaceBefore = 2
$table.Range.ParagraphFormat.SpaceAfter = 2
$table.Range.ParagraphFormat.LineSpacingRule = 0  # wdLineSpaceSingle = 0
# Set cell vertical alignment to center
for ($r = 1; $r -le $table.Rows.Count; $r++) {
  for ($c = 1; $c -le $table.Columns.Count; $c++) {
    try { $table.Cell($r, $c).VerticalAlignment = 1 } catch {}  # wdCellAlignVerticalCenter = 1
  }
}
# Set cell margins for better padding
try {
  $table.TopPadding = 4
  $table.BottomPadding = 4
  $table.LeftPadding = 6
  $table.RightPadding = 6
} catch {}
${dataScript}
# Move cursor after the table and add a new paragraph
$tableEnd = $table.Range
$tableEnd.Collapse(0)  # wdCollapseEnd = 0
$tableEnd.Select()
$word.Selection.TypeParagraph()
@{ success = $true; message = "Table added with ${rows} rows and ${cols} columns" } | ConvertTo-Json -Compress
`);
  }

  async wordAddImage(imagePath: string, width?: number, height?: number): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(imagePath).replace(/'/g, "''");
    const sizeScript = width || height
      ? `
${width ? '$shape.Width = ' + width : ''}
${height ? '$shape.Height = ' + height : ''}`
      : '';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$shape = $selection.InlineShapes.AddPicture('${windowsPath}')
${sizeScript}
# Move cursor after the image
$selection.MoveRight(1, 1)  # wdCharacter = 1
@{ success = $true; message = "Image added" } | ConvertTo-Json -Compress
`);
  }

  async wordDeleteText(start: number, end: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$range = $doc.Range(${start}, ${end})
$range.Delete()
@{ success = $true; message = "Text deleted from position ${start} to ${end}" } | ConvertTo-Json -Compress
`);
  }

  async wordFindReplace(find: string, replace: string, replaceAll: boolean = true): Promise<OfficeResponse> {
    const escapedFind = find.replace(/'/g, "''");
    const escapedReplace = replace.replace(/'/g, "''");
    const replaceOption = replaceAll ? '2' : '1'; // wdReplaceAll = 2, wdReplaceOne = 1

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$findObj = $doc.Content.Find
$findObj.ClearFormatting()
$findObj.Replacement.ClearFormatting()
$findObj.Text = '${escapedFind}'
$findObj.Replacement.Text = '${escapedReplace}'
$found = $findObj.Execute([ref]'${escapedFind}', [ref]$false, [ref]$false, [ref]$false, [ref]$false, [ref]$false, [ref]$true, [ref]0, [ref]$false, [ref]'${escapedReplace}', [ref]${replaceOption})
@{ success = $true; message = "Find and replace completed"; found = $found } | ConvertTo-Json -Compress
`);
  }

  async wordSetStyle(styleName: string, preserveKoreanFont: boolean = true): Promise<OfficeResponse> {
    // Use wdStyle constants for locale-independent style application
    const styleIdMap: Record<string, number> = {
      'Normal': -1, 'Heading 1': -2, 'Heading 2': -3, 'Heading 3': -4,
      'Heading 4': -5, 'Heading 5': -6,
    };
    const styleId = styleIdMap[styleName];
    const styleExpr = styleId !== undefined
      ? `$doc.Styles.Item(${styleId})`
      : `'${styleName.replace(/'/g, "''")}'`;

    // Preserve Korean font after style change to prevent garbled text
    const fontPreserveScript = preserveKoreanFont ? `
# Check if selection contains Korean text and preserve font
$selectedText = $selection.Text
if ($selectedText -match '[-ㄱ-ㅎㅏ-ㅣ]') {
  $selection.Font.Name = 'Malgun Gothic'
}` : '';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$selection.Style = ${styleExpr}
${fontPreserveScript}
@{ success = $true; message = "Style '${styleName}' applied" } | ConvertTo-Json -Compress
`);
  }

  async wordInsertBreak(breakType: 'page' | 'line' | 'section' = 'page'): Promise<OfficeResponse> {
    const breakTypeMap: Record<string, number> = { page: 7, line: 6, section: 2 }; // wdPageBreak, wdLineBreak, wdSectionBreakNextPage
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$selection.InsertBreak(${breakTypeMap[breakType]})
@{ success = $true; message = "${breakType} break inserted" } | ConvertTo-Json -Compress
`);
  }

  async wordGetSelection(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
@{
  success = $true
  text = $selection.Text
  start = $selection.Start
  end = $selection.End
  font_name = $selection.Font.Name
  font_size = $selection.Font.Size
} | ConvertTo-Json -Compress
`);
  }

  async wordSelectAll(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$word.ActiveDocument.Content.Select()
@{ success = $true; message = "All content selected" } | ConvertTo-Json -Compress
`);
  }

  async wordGoto(what: 'page' | 'line' | 'bookmark', target: number | string): Promise<OfficeResponse> {
    const whatMap: Record<string, number> = { page: 1, line: 3, bookmark: -1 };
    const isBookmark = what === 'bookmark';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
${isBookmark
    ? `$selection.GoTo(-1, 0, 0, '${String(target).replace(/'/g, "''")}')`
    : `$selection.GoTo(${whatMap[what]}, 0, ${target})`}
@{ success = $true; message = "Moved to ${what} ${target}" } | ConvertTo-Json -Compress
`);
  }

  async wordInsertHeader(text: string, options?: { fontName?: string; fontSize?: number }): Promise<OfficeResponse> {
    // Auto-detect Korean and set font
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : '');

    // Handle newlines
    const processedText = text.replace(/\\n/g, '\n');
    // Use Base64 encoding for safe Unicode/Korean transfer
    const base64Text = this.encodeTextForPowerShell(processedText);
    const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Text}'))`;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$section = $doc.Sections(1)
$header = $section.Headers(1).Range
$header.Text = ${decodeExpr}
${fontName ? `$header.Font.Name = '${fontName}'` : ''}
${options?.fontSize ? `$header.Font.Size = ${options.fontSize}` : ''}
@{ success = $true; message = "Header added" } | ConvertTo-Json -Compress
`);
  }

  async wordInsertFooter(text: string, options?: { fontName?: string; fontSize?: number }): Promise<OfficeResponse> {
    // Auto-detect Korean and set font
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : '');

    // Handle newlines
    const processedText = text.replace(/\\n/g, '\n');
    // Use Base64 encoding for safe Unicode/Korean transfer
    const base64Text = this.encodeTextForPowerShell(processedText);
    const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Text}'))`;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$section = $doc.Sections(1)
$footer = $section.Footers(1).Range
$footer.Text = ${decodeExpr}
${fontName ? `$footer.Font.Name = '${fontName}'` : ''}
${options?.fontSize ? `$footer.Font.Size = ${options.fontSize}` : ''}
@{ success = $true; message = "Footer added" } | ConvertTo-Json -Compress
`);
  }

  async wordInsertPageNumber(alignment: 'left' | 'center' | 'right' = 'center'): Promise<OfficeResponse> {
    const alignMap: Record<string, number> = { left: 0, center: 1, right: 2 };
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$section = $doc.Sections(1)
$footer = $section.Footers(1)
$footer.PageNumbers.Add(${alignMap[alignment]})
@{ success = $true; message = "Page numbers added" } | ConvertTo-Json -Compress
`);
  }

  async wordExportToPDF(outputPath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(outputPath).replace(/'/g, "''");
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.ExportAsFixedFormat('${windowsPath}', 17)  # 17 = wdExportFormatPDF
@{ success = $true; message = "Exported to PDF"; path = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  async wordPrint(copies: number = 1): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.PrintOut([ref]$false, [ref]$false, [ref]0, [ref]"", [ref]"", [ref]"", [ref]0, [ref]${copies})
@{ success = $true; message = "Print job sent (${copies} copies)" } | ConvertTo-Json -Compress
`);
  }

  async wordScreenshot(): Promise<ScreenshotResponse> {
    // Word screenshot via temporary file export
    const result = await this.executePowerShell(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument

# Switch to Print Preview to get a good screenshot
$originalView = $word.ActiveWindow.View.Type
$word.ActiveWindow.View.Type = 3  # wdPrintView

try {
  # Method 1: Try CopyAsPicture on content
  $doc.Content.Select()
  $word.Selection.CopyAsPicture()
  Start-Sleep -Milliseconds 300

  $img = [System.Windows.Forms.Clipboard]::GetImage()

  if ($img -eq $null) {
    # Method 2: Fallback - capture the Word window
    $hwnd = $word.Application.Hwnd
    if ($hwnd -gt 0) {
      Add-Type @"
        using System;
        using System.Drawing;
        using System.Runtime.InteropServices;
        public class Screenshot {
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          public struct RECT { public int Left, Top, Right, Bottom; }
          public static Bitmap CaptureWindow(IntPtr hwnd) {
            RECT rect;
            GetWindowRect(hwnd, out rect);
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0) return null;
            Bitmap bmp = new Bitmap(width, height);
            using (Graphics g = Graphics.FromImage(bmp)) {
              g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
            }
            return bmp;
          }
        }
"@
      [Screenshot]::SetForegroundWindow([IntPtr]$hwnd)
      Start-Sleep -Milliseconds 500
      $img = [Screenshot]::CaptureWindow([IntPtr]$hwnd)
    }
  }

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

  # Deselect
  $word.Selection.Collapse(1)

  @{
    success = $true
    image = $base64
    format = "jpeg"
    encoding = "base64"
  } | ConvertTo-Json -Compress
} finally {
  # Restore original view
  $word.ActiveWindow.View.Type = $originalView
}
`);
    return result as ScreenshotResponse;
  }

  // -------------------------------------------------------------------------
  // Word Table Manipulation
  // -------------------------------------------------------------------------

  async wordSetTableCell(
    tableIndex: number,
    row: number,
    col: number,
    text: string,
    options?: { fontName?: string; fontSize?: number; bold?: boolean }
  ): Promise<OfficeResponse> {
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    let fontName = options?.fontName?.replace(/'/g, "''") || '';
    if (!fontName && hasKorean) {
      fontName = 'Malgun Gothic';
    }

    // Handle newlines: convert \n to actual line breaks
    const processedText = text.replace(/\\n/g, '\n');
    // Use Base64 encoding for safe Unicode/Korean transfer
    const base64Text = this.encodeTextForPowerShell(processedText);
    const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Text}'))`;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
$cell = $table.Cell(${row}, ${col})
$cell.Range.Text = ${decodeExpr}
${fontName ? `$cell.Range.Font.Name = '${fontName}'` : ''}
${options?.fontSize ? `$cell.Range.Font.Size = ${options.fontSize}` : ''}
${options?.bold ? '$cell.Range.Font.Bold = -1' : ''}
@{ success = $true; message = "Table cell (${row},${col}) updated" } | ConvertTo-Json -Compress
`);
  }

  async wordMergeTableCells(
    tableIndex: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
$startCell = $table.Cell(${startRow}, ${startCol})
$endCell = $table.Cell(${endRow}, ${endCol})
$startCell.Merge($endCell)
@{ success = $true; message = "Table cells merged" } | ConvertTo-Json -Compress
`);
  }

  async wordSetTableStyle(tableIndex: number, styleName: string, preserveKoreanFont: boolean = true): Promise<OfficeResponse> {
    const escapedStyle = styleName.replace(/'/g, "''");

    // Map common style names to Word's built-in style constants (wdBuiltinStyle)
    // These work regardless of the UI language
    const styleConstMap: Record<string, number> = {
      'table grid': -176,
      'table normal': -106,
    };

    const lowerStyleName = styleName.toLowerCase();
    const styleConst = styleConstMap[lowerStyleName];

    // Preserve CJK font after style change to prevent text corruption
    const fontPreserveScript = preserveKoreanFont ? `
# Check if table contains CJK text and preserve font
$tableText = $table.Range.Text
if ($tableText -match '[-ㄱ-ㅎㅏ-ㅣ]') {
  $table.Range.Font.Name = 'Segoe UI'
}` : '';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
try {
  ${styleConst !== undefined
    ? `$table.Style = ${styleConst}`
    : `$table.Style = '${escapedStyle}'`}
  ${fontPreserveScript}
  @{ success = $true; message = "Table style set" } | ConvertTo-Json -Compress
} catch {
  # Try with style name directly if constant fails
  try {
    $table.Style = '${escapedStyle}'
    ${fontPreserveScript}
    @{ success = $true; message = "Table style set to '${escapedStyle}'" } | ConvertTo-Json -Compress
  } catch {
    @{ success = $false; error = "Style '${escapedStyle}' not found. Try: 'Table Grid', 'Table Normal', or numeric style index." } | ConvertTo-Json -Compress
  }
}
`);
  }

  async wordStyleTableHeaderRow(
    tableIndex: number,
    bgColor: string,
    textColor: string = '#FFFFFF',
  ): Promise<OfficeResponse> {
    const bgRgb = this.hexToRgb(bgColor);
    const textRgb = this.hexToRgb(textColor);
    if (!bgRgb || !textRgb) {
      return { success: false, error: 'Invalid color hex value' } as OfficeResponse;
    }

    const bgWd = bgRgb.r + bgRgb.g * 256 + bgRgb.b * 65536;
    const textWd = textRgb.r + textRgb.g * 256 + textRgb.b * 65536;
    const lightR = Math.round(bgRgb.r * 0.08 + 255 * 0.92);
    const lightG = Math.round(bgRgb.g * 0.08 + 255 * 0.92);
    const lightB = Math.round(bgRgb.b * 0.08 + 255 * 0.92);
    const lightWd = lightR + lightG * 256 + lightB * 65536;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
$headerRow = $table.Rows(1)
$headerRow.Shading.BackgroundPatternColor = ${bgWd}
$headerRow.Range.Font.Color = ${textWd}
$headerRow.Range.Font.Bold = -1
$headerRow.Range.Font.Size = 11
$headerRow.Range.ParagraphFormat.Alignment = 1  # wdAlignParagraphCenter
$headerRow.Range.ParagraphFormat.SpaceBefore = 3
$headerRow.Range.ParagraphFormat.SpaceAfter = 3
for ($i = 3; $i -le $table.Rows.Count; $i += 2) {
  try { $table.Rows($i).Shading.BackgroundPatternColor = ${lightWd} } catch {}
}
$tableText = $table.Range.Text
if ($tableText -match '[-ㄱ-ㅎㅏ-ㅣ]') {
  $table.Range.Font.Name = 'Malgun Gothic'
  $headerRow.Range.Font.Name = 'Malgun Gothic'
}
@{ success = $true; message = "Table header row styled" } | ConvertTo-Json -Compress
`);
  }

  async wordSetTableBorder(
    tableIndex: number,
    options: { style?: 'single' | 'double' | 'thick' | 'none'; color?: string }
  ): Promise<OfficeResponse> {
    // wdLineStyleSingle=1, wdLineStyleDouble=7, wdLineStyleThickThinLargeGap=14, wdLineStyleNone=0
    const styleMap: Record<string, number> = {
      single: 1,
      double: 7,
      thick: 14,
      none: 0,
    };
    const lineStyle = styleMap[options.style || 'single'] ?? 1;

    const colorValue = options.color ? (() => {
      const rgb = this.hexToRgb(options.color);
      return rgb ? rgb.r + rgb.g * 256 + rgb.b * 65536 : 0;
    })() : 0;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})

# Border indices: wdBorderTop=-1, wdBorderLeft=-2, wdBorderBottom=-3, wdBorderRight=-4
# wdBorderHorizontal=-5, wdBorderVertical=-6
$borderIndices = @(-1, -2, -3, -4)
foreach ($idx in $borderIndices) {
  $table.Borders.Item($idx).LineStyle = ${lineStyle}
  ${colorValue ? `$table.Borders.Item($idx).Color = ${colorValue}` : ''}
}

# Inside borders (may not exist for 1-row or 1-column tables)
try {
  $table.Borders.Item(-5).LineStyle = ${lineStyle}  # Horizontal inside
  ${colorValue ? `$table.Borders.Item(-5).Color = ${colorValue}` : ''}
} catch {}
try {
  $table.Borders.Item(-6).LineStyle = ${lineStyle}  # Vertical inside
  ${colorValue ? `$table.Borders.Item(-6).Color = ${colorValue}` : ''}
} catch {}

@{ success = $true; message = "Table border set" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Bookmark
  // -------------------------------------------------------------------------

  async wordAddBookmark(name: string, text?: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    const escapedText = text ? text.replace(/'/g, "''") : '';
    const originalTextLength = text ? text.length : 0;  // Use original length, not escaped
    const hasKorean = text ? /[-ㄱ-ㅎㅏ-ㅣ]/.test(text) : false;

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
${text ? `${hasKorean ? "$selection.Font.Name = 'Malgun Gothic'" : ''}
$selection.TypeText('${escapedText}')
$selection.MoveLeft(1, ${originalTextLength}, 1)` : ''}
$doc.Bookmarks.Add('${escapedName}', $selection.Range)
@{ success = $true; message = "Bookmark '${escapedName}' added" } | ConvertTo-Json -Compress
`);
  }

  async wordGetBookmarks(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$bookmarks = @()
foreach ($bm in $doc.Bookmarks) {
  $bookmarks += @{
    name = $bm.Name
    start = $bm.Range.Start
    end = $bm.Range.End
    text = $bm.Range.Text
  }
}
@{ success = $true; bookmarks = $bookmarks } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async wordDeleteBookmark(name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if ($doc.Bookmarks.Exists('${escapedName}')) {
  $doc.Bookmarks('${escapedName}').Delete()
  @{ success = $true; message = "Bookmark '${escapedName}' deleted" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Bookmark '${escapedName}' not found" } | ConvertTo-Json -Compress
}
`);
  }

  async wordGotoBookmark(name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if ($doc.Bookmarks.Exists('${escapedName}')) {
  $doc.Bookmarks('${escapedName}').Select()
  @{ success = $true; message = "Moved to bookmark '${escapedName}'" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Bookmark '${escapedName}' not found" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Word Comments
  // -------------------------------------------------------------------------

  async wordAddComment(commentText: string, author?: string): Promise<OfficeResponse> {
    const escapedText = commentText.replace(/'/g, "''");
    const escapedAuthor = author?.replace(/'/g, "''") || '';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$comment = $doc.Comments.Add($selection.Range, '${escapedText}')
${escapedAuthor ? `$comment.Author = '${escapedAuthor}'` : ''}
@{ success = $true; message = "Comment added" } | ConvertTo-Json -Compress
`);
  }

  async wordGetComments(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$comments = @()
foreach ($c in $doc.Comments) {
  $comments += @{
    index = $c.Index
    author = $c.Author
    text = $c.Range.Text
    date = $c.Date.ToString("yyyy-MM-dd HH:mm:ss")
    scope = $c.Scope.Text
  }
}
@{ success = $true; comments = $comments; count = $doc.Comments.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async wordDeleteComment(index: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if (${index} -le $doc.Comments.Count) {
  $doc.Comments(${index}).Delete()
  @{ success = $true; message = "Comment ${index} deleted" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Comment index ${index} out of range" } | ConvertTo-Json -Compress
}
`);
  }

  async wordDeleteAllComments(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$count = $doc.Comments.Count
while ($doc.Comments.Count -gt 0) {
  $doc.Comments(1).Delete()
}
@{ success = $true; message = "Deleted $count comments" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Lists
  // -------------------------------------------------------------------------

  async wordCreateBulletList(items: string[]): Promise<OfficeResponse> {
    // Use Base64 encoding for safe Unicode/Korean transfer
    const itemsScript = items.map(item => {
      const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(item);
      const base64Item = this.encodeTextForPowerShell(item);
      const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Item}'))`;
      // Text first, then font after
      return `$selection.TypeText(${decodeExpr})
${hasKorean ? "$selection.Font.Name = 'Malgun Gothic'" : ''}
$selection.TypeParagraph()`;
    }).join('\n');

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$selection.Font.Size = 11
$selection.Font.Name = 'Malgun Gothic'
$selection.Range.ListFormat.ApplyBulletDefault()
${itemsScript}
$selection.Range.ListFormat.RemoveNumbers()
@{ success = $true; message = "Bullet list created with ${items.length} items" } | ConvertTo-Json -Compress
`);
  }

  async wordCreateNumberedList(items: string[]): Promise<OfficeResponse> {
    // Use Base64 encoding for safe Unicode/Korean transfer
    const itemsScript = items.map(item => {
      const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(item);
      const base64Item = this.encodeTextForPowerShell(item);
      const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Item}'))`;
      // Text first, then font after
      return `$selection.TypeText(${decodeExpr})
${hasKorean ? "$selection.Font.Name = 'Malgun Gothic'" : ''}
$selection.TypeParagraph()`;
    }).join('\n');

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$selection.Font.Size = 11
$selection.Font.Name = 'Malgun Gothic'
$selection.Range.ListFormat.ApplyNumberDefault()
${itemsScript}
$selection.Range.ListFormat.RemoveNumbers()
@{ success = $true; message = "Numbered list created with ${items.length} items" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Page Setup
  // -------------------------------------------------------------------------

  async wordSetPageMargins(options: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }): Promise<OfficeResponse> {
    // Input: cm. Word COM expects points (1 cm = 28.3465 points)
    const cmToPoints = (cm: number) => Math.round(cm * 28.3465 * 100) / 100;
    const commands: string[] = [];
    if (options.top !== undefined) commands.push(`$pageSetup.TopMargin = ${cmToPoints(options.top)}`);
    if (options.bottom !== undefined) commands.push(`$pageSetup.BottomMargin = ${cmToPoints(options.bottom)}`);
    if (options.left !== undefined) commands.push(`$pageSetup.LeftMargin = ${cmToPoints(options.left)}`);
    if (options.right !== undefined) commands.push(`$pageSetup.RightMargin = ${cmToPoints(options.right)}`);

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$pageSetup = $doc.PageSetup
${commands.join('\n')}
@{ success = $true; message = "Page margins updated" } | ConvertTo-Json -Compress
`);
  }

  async wordSetPageOrientation(orientation: 'portrait' | 'landscape'): Promise<OfficeResponse> {
    // wdOrientPortrait=0, wdOrientLandscape=1
    const value = orientation === 'landscape' ? 1 : 0;
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.PageSetup.Orientation = ${value}
@{ success = $true; message = "Page orientation set to ${orientation}" } | ConvertTo-Json -Compress
`);
  }

  async wordSetPageSize(size: 'A4' | 'Letter' | 'Legal' | 'A3' | 'B5' | 'custom', width?: number, height?: number): Promise<OfficeResponse> {
    // wdPaperA4=7, wdPaperLetter=2, wdPaperLegal=4, wdPaperA3=6, wdPaperB5=13
    const sizeMap: Record<string, number> = {
      A4: 7,
      Letter: 2,
      Legal: 4,
      A3: 6,
      B5: 13,
    };

    if (size === 'custom' && width && height) {
      return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.PageSetup.PageWidth = ${width}
$doc.PageSetup.PageHeight = ${height}
@{ success = $true; message = "Page size set to custom (${width}x${height})" } | ConvertTo-Json -Compress
`);
    }

    const paperSize = sizeMap[size] ?? 7;
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.PageSetup.PaperSize = ${paperSize}
@{ success = $true; message = "Page size set to ${size}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Watermark
  // -------------------------------------------------------------------------

  async wordAddWatermark(text: string, options?: {
    fontName?: string;
    fontSize?: number;
    color?: string;
    semitransparent?: boolean;
  }): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");
    const fontName = options?.fontName?.replace(/'/g, "''") || 'Arial';
    const fontSize = options?.fontSize || 72;
    const colorValue = options?.color ? (() => {
      const rgb = this.hexToRgb(options.color);
      return rgb ? rgb.r + rgb.g * 256 + rgb.b * 65536 : 12632256; // default light gray
    })() : 12632256;
    const semitransparent = options?.semitransparent !== false ? '0.5' : '0';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument

# Store original view and switch to Print Layout to access headers
$originalView = $word.ActiveWindow.View.Type
$word.ActiveWindow.View.Type = 3  # wdPrintView

try {
  # Add watermark to header
  $section = $doc.Sections(1)
  $header = $section.Headers(1)  # wdHeaderFooterPrimary = 1

  # Create text effect shape (without Select to avoid view access issues)
  $shape = $header.Shapes.AddTextEffect(0, '${escapedText}', '${fontName}', ${fontSize}, 0, 0, 0, 0)
  $shape.Name = "PowerPlusWaterMarkObject"
  $shape.TextEffect.NormalizedHeight = 0
  $shape.Line.Visible = 0
  $shape.Fill.Visible = -1
  $shape.Fill.Solid()
  $shape.Fill.ForeColor.RGB = ${colorValue}
  $shape.Fill.Transparency = ${semitransparent}
  $shape.Rotation = 315
  $shape.LockAspectRatio = -1
  $shape.Height = 100
  $shape.Width = 350
  $shape.Left = -999995  # wdShapeCenter
  $shape.Top = -999995   # wdShapeCenter
  $shape.WrapFormat.AllowOverlap = -1
  $shape.WrapFormat.Type = 3  # wdWrapBehind

  @{ success = $true; message = "Watermark added" } | ConvertTo-Json -Compress
} finally {
  # Restore original view
  $word.ActiveWindow.View.Type = $originalView
}
`);
  }

  async wordRemoveWatermark(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument

# Switch to Print Layout view to access headers (wdPrintView = 3)
$word.ActiveWindow.View.Type = 3

foreach ($section in $doc.Sections) {
  $header = $section.Headers(1)
  foreach ($shape in $header.Shapes) {
    if ($shape.Name -like "*WaterMark*") {
      $shape.Delete()
    }
  }
}
@{ success = $true; message = "Watermark removed" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Textbox & Shapes
  // -------------------------------------------------------------------------

  async wordAddTextbox(
    text: string,
    left: number,
    top: number,
    width: number,
    height: number,
    options?: { fontName?: string; fontSize?: number; borderColor?: string; fillColor?: string }
  ): Promise<OfficeResponse> {
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    let fontName = options?.fontName?.replace(/'/g, "''") || '';
    if (!fontName && hasKorean) {
      fontName = 'Malgun Gothic';
    }

    // Handle newlines
    const processedText = text.replace(/\\n/g, '\n');
    // Use Base64 encoding for safe Unicode/Korean transfer
    const base64Text = this.encodeTextForPowerShell(processedText);
    const decodeExpr = `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Text}'))`;

    const commands: string[] = [];
    if (fontName) commands.push(`$shape.TextFrame.TextRange.Font.Name = '${fontName}'`);
    if (options?.fontSize) commands.push(`$shape.TextFrame.TextRange.Font.Size = ${options.fontSize}`);
    if (options?.borderColor) {
      const rgb = this.hexToRgb(options.borderColor);
      if (rgb) {
        commands.push('$shape.Line.Visible = -1');
        commands.push(`$shape.Line.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    }
    if (options?.fillColor) {
      const rgb = this.hexToRgb(options.fillColor);
      if (rgb) {
        commands.push('$shape.Fill.Visible = -1');
        commands.push(`$shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    } else {
      commands.push('$shape.Fill.Visible = 0');
    }

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$shape = $doc.Shapes.AddTextbox(1, ${left}, ${top}, ${width}, ${height})
${fontName ? `$shape.TextFrame.TextRange.Font.Name = '${fontName}'` : ''}
$shape.TextFrame.TextRange.Text = ${decodeExpr}
${commands.filter(c => !c.includes('Font.Name')).join('\n')}
@{ success = $true; message = "Textbox added"; shape_name = $shape.Name } | ConvertTo-Json -Compress
`);
  }

  async wordAddShape(
    shapeType: 'rectangle' | 'oval' | 'roundedRectangle' | 'triangle' | 'diamond' | 'arrow' | 'line',
    left: number,
    top: number,
    width: number,
    height: number,
    options?: { fillColor?: string; lineColor?: string; lineWeight?: number }
  ): Promise<OfficeResponse> {
    // Line is special - use AddLine instead of AddShape
    if (shapeType === 'line') {
      return this.wordAddLine(left, top, left + width, top + height, options);
    }

    // msoShapeRectangle=1, msoShapeOval=9, msoShapeRoundedRectangle=5,
    // msoShapeIsoscelesTriangle=7, msoShapeDiamond=4, msoShapeRightArrow=33
    const shapeMap: Record<string, number> = {
      rectangle: 1,
      oval: 9,
      roundedRectangle: 5,
      triangle: 7,
      diamond: 4,
      arrow: 33,
    };
    const shapeTypeValue = shapeMap[shapeType] ?? 1;

    const commands: string[] = [];
    if (options?.fillColor) {
      const rgb = this.hexToRgb(options.fillColor);
      if (rgb) {
        commands.push('$shape.Fill.Visible = -1');
        commands.push('$shape.Fill.Solid()');
        commands.push(`$shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    }
    if (options?.lineColor) {
      const rgb = this.hexToRgb(options.lineColor);
      if (rgb) {
        commands.push('$shape.Line.Visible = -1');
        commands.push(`$shape.Line.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    }
    if (options?.lineWeight) {
      commands.push(`$shape.Line.Weight = ${options.lineWeight}`);
    }

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$shape = $doc.Shapes.AddShape(${shapeTypeValue}, ${left}, ${top}, ${width}, ${height})
${commands.join('\n')}
@{ success = $true; message = "Shape added"; shape_name = $shape.Name } | ConvertTo-Json -Compress
`);
  }

  /**
   * Add a line shape to the document
   */
  private async wordAddLine(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: { lineColor?: string; lineWeight?: number }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];
    if (options?.lineColor) {
      const rgb = this.hexToRgb(options.lineColor);
      if (rgb) {
        commands.push('$shape.Line.Visible = -1');
        commands.push(`$shape.Line.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    }
    if (options?.lineWeight) {
      commands.push(`$shape.Line.Weight = ${options.lineWeight}`);
    }

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$shape = $doc.Shapes.AddLine(${startX}, ${startY}, ${endX}, ${endY})
${commands.join('\n')}
@{ success = $true; message = "Line added"; shape_name = $shape.Name } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Document Info
  // -------------------------------------------------------------------------

  async wordGetDocumentInfo(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$stats = $doc.ComputeStatistics(0)  # wdStatisticWords

@{
  success = $true
  name = $doc.Name
  path = $doc.FullName
  pages = $doc.ComputeStatistics(2)  # wdStatisticPages
  words = $doc.ComputeStatistics(0)  # wdStatisticWords
  characters = $doc.ComputeStatistics(3)  # wdStatisticCharacters
  characters_with_spaces = $doc.ComputeStatistics(5)  # wdStatisticCharactersWithSpaces
  paragraphs = $doc.ComputeStatistics(4)  # wdStatisticParagraphs
  lines = $doc.ComputeStatistics(1)  # wdStatisticLines
  saved = $doc.Saved
  read_only = $doc.ReadOnly
} | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Columns
  // -------------------------------------------------------------------------

  async wordSetColumns(count: number, spacing?: number): Promise<OfficeResponse> {
    // spacing is the gap between columns in points (1 inch = 72 points)
    const spacingScript = spacing !== undefined ? `$pageSetup.TextColumns.Spacing = ${spacing}` : '';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$pageSetup = $doc.PageSetup
$pageSetup.TextColumns.SetCount(${count})
${spacingScript}
@{ success = $true; message = "Columns set to ${count}${spacing !== undefined ? ` with spacing ${spacing}pt` : ''}" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Undo/Redo
  // -------------------------------------------------------------------------

  async wordUndo(times: number = 1): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
for ($i = 0; $i -lt ${times}; $i++) {
  $doc.Undo()
}
@{ success = $true; message = "Undo performed ${times} time(s)" } | ConvertTo-Json -Compress
`);
  }

  async wordRedo(times: number = 1): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
for ($i = 0; $i -lt ${times}; $i++) {
  $doc.Redo()
}
@{ success = $true; message = "Redo performed ${times} time(s)" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Selection
  // -------------------------------------------------------------------------

  async wordGetSelectedText(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
@{
  success = $true
  text = $selection.Text
  start = $selection.Start
  end = $selection.End
  type = $selection.Type  # 0=none, 1=normal, 2=IP (insertion point)
} | ConvertTo-Json -Compress
`);
  }

  /**
   * Select a range of text by start and end positions
   */
  async wordSelectRange(start: number, end: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$range = $doc.Range(${start}, ${end})
$range.Select()
@{ success = $true; message = "Selected range from ${start} to ${end}"; text = $range.Text } | ConvertTo-Json -Compress
`);
  }

  /**
   * Move cursor by character, word, line, or paragraph
   */
  async wordMoveCursor(
    unit: 'character' | 'word' | 'line' | 'paragraph',
    count: number,
    extend: boolean = false
  ): Promise<OfficeResponse> {
    // wdCharacter=1, wdWord=2, wdLine=5, wdParagraph=4
    const unitMap: Record<string, number> = { character: 1, word: 2, line: 5, paragraph: 4 };
    const unitValue = unitMap[unit] ?? 1;
    const direction = count >= 0 ? 'MoveRight' : 'MoveLeft';
    const absCount = Math.abs(count);
    const extendMode = extend ? '1' : '0'; // wdExtend=1, wdMove=0

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$selection.${direction}(${unitValue}, ${absCount}, ${extendMode})
@{
  success = $true
  message = "Cursor moved ${count} ${unit}(s)"
  position = $selection.Start
  end_position = $selection.End
} | ConvertTo-Json -Compress
`);
  }

  /**
   * Move cursor to start or end of document
   */
  async wordMoveCursorTo(position: 'start' | 'end'): Promise<OfficeResponse> {
    const method = position === 'start' ? 'HomeKey' : 'EndKey';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$selection = $word.Selection
$selection.${method}(6)  # wdStory = 6
@{ success = $true; message = "Cursor moved to ${position} of document"; position = $selection.Start } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Table Row/Column Operations
  // -------------------------------------------------------------------------

  /**
   * Add a row to a table
   */
  async wordAddTableRow(tableIndex: number, position?: number): Promise<OfficeResponse> {
    const positionScript = position !== undefined
      ? `$row = $table.Rows(${position})\n$table.Rows.Add($row)`
      : '$table.Rows.Add()';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
${positionScript}
@{ success = $true; message = "Row added to table ${tableIndex}"; total_rows = $table.Rows.Count } | ConvertTo-Json -Compress
`);
  }

  /**
   * Add a column to a table
   */
  async wordAddTableColumn(tableIndex: number, position?: number): Promise<OfficeResponse> {
    const positionScript = position !== undefined
      ? `$col = $table.Columns(${position})\n$table.Columns.Add($col)`
      : '$table.Columns.Add()';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
${positionScript}
@{ success = $true; message = "Column added to table ${tableIndex}"; total_columns = $table.Columns.Count } | ConvertTo-Json -Compress
`);
  }

  /**
   * Delete a row from a table
   */
  async wordDeleteTableRow(tableIndex: number, rowIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
if (${rowIndex} -le $table.Rows.Count) {
  $table.Rows(${rowIndex}).Delete()
  @{ success = $true; message = "Row ${rowIndex} deleted from table ${tableIndex}"; remaining_rows = $table.Rows.Count } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Row index ${rowIndex} out of range (table has $($table.Rows.Count) rows)" } | ConvertTo-Json -Compress
}
`);
  }

  /**
   * Delete a column from a table
   */
  async wordDeleteTableColumn(tableIndex: number, colIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$table = $doc.Tables(${tableIndex})
if (${colIndex} -le $table.Columns.Count) {
  $table.Columns(${colIndex}).Delete()
  @{ success = $true; message = "Column ${colIndex} deleted from table ${tableIndex}"; remaining_columns = $table.Columns.Count } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Column index ${colIndex} out of range (table has $($table.Columns.Count) columns)" } | ConvertTo-Json -Compress
}
`);
  }

  /**
   * Get table information
   */
  async wordGetTableInfo(tableIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if (${tableIndex} -le $doc.Tables.Count) {
  $table = $doc.Tables(${tableIndex})
  @{
    success = $true
    table_index = ${tableIndex}
    rows = $table.Rows.Count
    columns = $table.Columns.Count
    style = $table.Style
  } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Table index ${tableIndex} out of range (document has $($doc.Tables.Count) tables)" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Word Track Changes
  // -------------------------------------------------------------------------

  /**
   * Enable or disable track changes
   */
  async wordSetTrackChanges(enabled: boolean): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$doc.TrackRevisions = ${enabled ? '$true' : '$false'}
@{ success = $true; message = "Track changes ${enabled ? 'enabled' : 'disabled'}"; track_revisions = $doc.TrackRevisions } | ConvertTo-Json -Compress
`);
  }

  /**
   * Get track changes status
   */
  async wordGetTrackChanges(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$revisions = @()
foreach ($rev in $doc.Revisions) {
  $revisions += @{
    index = $rev.Index
    author = $rev.Author
    type = $rev.Type
    text = $rev.Range.Text
    date = $rev.Date.ToString("yyyy-MM-dd HH:mm:ss")
  }
}
@{
  success = $true
  track_revisions = $doc.TrackRevisions
  revision_count = $doc.Revisions.Count
  revisions = $revisions
} | ConvertTo-Json -Compress -Depth 5
`);
  }

  /**
   * Accept all revisions
   */
  async wordAcceptAllRevisions(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$count = $doc.Revisions.Count
$doc.AcceptAllRevisions()
@{ success = $true; message = "Accepted $count revisions" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Reject all revisions
   */
  async wordRejectAllRevisions(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$count = $doc.Revisions.Count
$doc.RejectAllRevisions()
@{ success = $true; message = "Rejected $count revisions" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Accept or reject a specific revision
   */
  async wordHandleRevision(index: number, accept: boolean): Promise<OfficeResponse> {
    const method = accept ? 'Accept' : 'Reject';
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if (${index} -le $doc.Revisions.Count) {
  $doc.Revisions(${index}).${method}()
  @{ success = $true; message = "Revision ${index} ${accept ? 'accepted' : 'rejected'}" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Revision index ${index} out of range" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Word Table of Contents
  // -------------------------------------------------------------------------

  /**
   * Insert a table of contents
   */
  async wordInsertTOC(options?: {
    useHeadingStyles?: boolean;
    upperHeadingLevel?: number;
    lowerHeadingLevel?: number;
    useHyperlinks?: boolean;
  }): Promise<OfficeResponse> {
    const useHeadingStyles = options?.useHeadingStyles !== false ? '$true' : '$false';
    const upperLevel = options?.upperHeadingLevel ?? 1;
    const lowerLevel = options?.lowerHeadingLevel ?? 3;
    const useHyperlinks = options?.useHyperlinks !== false ? '$true' : '$false';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$range = $selection.Range
$toc = $doc.TablesOfContents.Add($range, ${useHeadingStyles}, ${upperLevel}, ${lowerLevel}, $false, "", $true, ${useHyperlinks})
@{ success = $true; message = "Table of contents inserted (Heading ${upperLevel}-${lowerLevel})" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Update all tables of contents
   */
  async wordUpdateTOC(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$count = $doc.TablesOfContents.Count
foreach ($toc in $doc.TablesOfContents) {
  $toc.Update()
}
@{ success = $true; message = "Updated $count table(s) of contents" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Delete all tables of contents
   */
  async wordDeleteTOC(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$count = $doc.TablesOfContents.Count
while ($doc.TablesOfContents.Count -gt 0) {
  $doc.TablesOfContents(1).Delete()
}
@{ success = $true; message = "Deleted $count table(s) of contents" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Word Footnotes & Endnotes
  // -------------------------------------------------------------------------

  /**
   * Add a footnote at the current selection
   */
  async wordAddFootnote(text: string): Promise<OfficeResponse> {
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const base64Text = this.encodeTextForPowerShell(text);
    const decodeExpr = this.getPowerShellDecodeExpr(base64Text);

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$footnote = $doc.Footnotes.Add($selection.Range)
$footnote.Range.Text = ${decodeExpr}
${hasKorean ? "$footnote.Range.Font.Name = 'Malgun Gothic'" : ''}
@{ success = $true; message = "Footnote added"; index = $footnote.Index } | ConvertTo-Json -Compress
`);
  }

  /**
   * Add an endnote at the current selection
   */
  async wordAddEndnote(text: string): Promise<OfficeResponse> {
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const base64Text = this.encodeTextForPowerShell(text);
    const decodeExpr = this.getPowerShellDecodeExpr(base64Text);

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$endnote = $doc.Endnotes.Add($selection.Range)
$endnote.Range.Text = ${decodeExpr}
${hasKorean ? "$endnote.Range.Font.Name = 'Malgun Gothic'" : ''}
@{ success = $true; message = "Endnote added"; index = $endnote.Index } | ConvertTo-Json -Compress
`);
  }

  /**
   * Get all footnotes in the document
   */
  async wordGetFootnotes(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$footnotes = @()
foreach ($fn in $doc.Footnotes) {
  $footnotes += @{
    index = $fn.Index
    text = $fn.Range.Text
    reference_text = $fn.Reference.Text
  }
}
@{ success = $true; footnotes = $footnotes; count = $doc.Footnotes.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  /**
   * Get all endnotes in the document
   */
  async wordGetEndnotes(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$endnotes = @()
foreach ($en in $doc.Endnotes) {
  $endnotes += @{
    index = $en.Index
    text = $en.Range.Text
    reference_text = $en.Reference.Text
  }
}
@{ success = $true; endnotes = $endnotes; count = $doc.Endnotes.Count } | ConvertTo-Json -Compress -Depth 5
`);
  }

  /**
   * Delete a footnote by index
   */
  async wordDeleteFootnote(index: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if (${index} -le $doc.Footnotes.Count) {
  $doc.Footnotes(${index}).Delete()
  @{ success = $true; message = "Footnote ${index} deleted" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Footnote index ${index} out of range" } | ConvertTo-Json -Compress
}
`);
  }

  /**
   * Delete an endnote by index
   */
  async wordDeleteEndnote(index: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
if (${index} -le $doc.Endnotes.Count) {
  $doc.Endnotes(${index}).Delete()
  @{ success = $true; message = "Endnote ${index} deleted" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Endnote index ${index} out of range" } | ConvertTo-Json -Compress
}
`);
  }

  // -------------------------------------------------------------------------
  // Word Find (without replace)
  // -------------------------------------------------------------------------

  /**
   * Find text and optionally select it
   */
  async wordFind(text: string, options?: {
    matchCase?: boolean;
    matchWholeWord?: boolean;
    selectFound?: boolean;
  }): Promise<OfficeResponse> {
    const base64Text = this.encodeTextForPowerShell(text);
    const decodeExpr = this.getPowerShellDecodeExpr(base64Text);
    const matchCase = options?.matchCase ? '$true' : '$false';
    const matchWholeWord = options?.matchWholeWord ? '$true' : '$false';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$selection = $word.Selection
$selection.HomeKey(6)  # Move to start of document
$searchText = ${decodeExpr}
$find = $selection.Find
$find.ClearFormatting()
$find.Text = $searchText
$find.MatchCase = ${matchCase}
$find.MatchWholeWord = ${matchWholeWord}
$find.Forward = $true
$find.Wrap = 0  # wdFindStop

$found = $find.Execute()
if ($found) {
  @{
    success = $true
    found = $true
    start = $selection.Start
    end = $selection.End
    text = $selection.Text
  } | ConvertTo-Json -Compress
} else {
  @{ success = $true; found = $false; message = "Text not found" } | ConvertTo-Json -Compress
}
`);
  }

  /**
   * Find all occurrences of text
   */
  async wordFindAll(text: string, options?: {
    matchCase?: boolean;
    matchWholeWord?: boolean;
  }): Promise<OfficeResponse> {
    const base64Text = this.encodeTextForPowerShell(text);
    const decodeExpr = this.getPowerShellDecodeExpr(base64Text);
    const matchCase = options?.matchCase ? '$true' : '$false';
    const matchWholeWord = options?.matchWholeWord ? '$true' : '$false';

    return this.executePowerShell(`
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
$doc = $word.ActiveDocument
$range = $doc.Content
$searchText = ${decodeExpr}
$find = $range.Find
$find.ClearFormatting()
$find.Text = $searchText
$find.MatchCase = ${matchCase}
$find.MatchWholeWord = ${matchWholeWord}
$find.Forward = $true

$matches = @()
while ($find.Execute()) {
  $matches += @{
    start = $range.Start
    end = $range.End
    text = $range.Text
  }
  $range.Collapse(0)  # wdCollapseEnd
}

@{ success = $true; count = $matches.Count; matches = $matches } | ConvertTo-Json -Compress -Depth 5
`);
  }

}

// Export singleton instance
export const wordClient = new WordClient();
export type { OfficeResponse, ScreenshotResponse };

