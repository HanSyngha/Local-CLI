/**
 * PowerPoint Client
 *
 * Microsoft PowerPoint automation via PowerShell COM.
 * Extends OfficeClientBase with PowerPoint-specific operations.
 */

import { OfficeClientBase, OfficeResponse, ScreenshotResponse } from './office-client-base';

export class PowerPointClient extends OfficeClientBase {
  protected override comProgId = 'PowerPoint.Application';
  protected override displayAlertsSuppressExpr = '1'; // ppAlertsNone

  async powerpointLaunch(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
  $ppt.Visible = -1  # msoTrue
  @{ success = $true; message = "Connected to existing PowerPoint instance" } | ConvertTo-Json -Compress
} catch {
  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = -1  # msoTrue
  @{ success = $true; message = "Launched new PowerPoint instance" } | ConvertTo-Json -Compress
}
`);
  }

  async powerpointCreate(): Promise<OfficeResponse> {
    return this.executePowerShell(`
try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
} catch {
  $ppt = New-Object -ComObject PowerPoint.Application
}
$ppt.DisplayAlerts = 1  # ppAlertsNone
$ppt.Visible = -1  # msoTrue
$presentation = $ppt.Presentations.Add(-1)
$ppt.DisplayAlerts = 2  # ppAlertsAll
@{ success = $true; message = "Created new presentation"; presentation_name = $presentation.Name } | ConvertTo-Json -Compress
`);
  }

  async powerpointOpen(filePath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(filePath).replace(/'/g, "''");
    return this.executePowerShell(`
try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
} catch {
  $ppt = New-Object -ComObject PowerPoint.Application
}
$ppt.DisplayAlerts = 1  # ppAlertsNone
$ppt.Visible = -1  # msoTrue
$presentation = $ppt.Presentations.Open('${windowsPath}')
$ppt.DisplayAlerts = 2  # ppAlertsAll
@{ success = $true; message = "Presentation opened"; presentation_name = $presentation.Name; path = $presentation.FullName } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddSlide(layout: number = 1): Promise<OfficeResponse> {
    // Layout: 1=Title Slide, 2=Title and Content, 3=Section Header, 4=Two Content, etc.
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slideCount = $presentation.Slides.Count
$customLayout = $presentation.SlideMaster.CustomLayouts(${layout})
$slide = $presentation.Slides.AddSlide($slideCount + 1, $customLayout)
@{ success = $true; message = "Slide added"; slide_number = $slide.SlideIndex; layout = ${layout} } | ConvertTo-Json -Compress
`);
  }

  async powerpointDeleteSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$presentation.Slides(${slideNumber}).Delete()
@{ success = $true; message = "Slide ${slideNumber} deleted" } | ConvertTo-Json -Compress
`);
  }

  async powerpointMoveSlide(fromIndex: number, toIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$presentation.Slides(${fromIndex}).MoveTo(${toIndex})
@{ success = $true; message = "Slide moved from ${fromIndex} to ${toIndex}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointWriteText(
    slideNumber: number,
    shapeIndex: number,
    text: string,
    options?: { fontName?: string; fontSize?: number; bold?: boolean }
  ): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");

    // Auto-detect Korean and set font
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : '');

    // IMPORTANT: Set text FIRST, then apply font formatting
    // Setting .Text = can reset font in some Office apps
    const formatCommands: string[] = [];
    if (fontName) formatCommands.push(`$textRange.Font.Name = '${fontName.replace(/'/g, "''")}'`);
    if (options?.fontSize) formatCommands.push(`$textRange.Font.Size = ${options.fontSize}`);
    if (options?.bold !== undefined) formatCommands.push(`$textRange.Font.Bold = ${options.bold ? '-1' : '0'}`);

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$textRange = $shape.TextFrame.TextRange
$textContent = '${escapedText}' -replace '\\\\n', [char]10 -replace '\\n', [char]10
$textRange.Text = $textContent
${formatCommands.join('\n')}
@{ success = $true; message = "Text written to slide ${slideNumber}, shape ${shapeIndex}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointReadSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$texts = @()
foreach ($shape in $slide.Shapes) {
  if ($shape.HasTextFrame -eq -1) {
    $texts += @{
      shape_index = $shape.Index
      shape_name = $shape.Name
      text = $shape.TextFrame.TextRange.Text
    }
  }
}
@{
  success = $true
  slide_number = ${slideNumber}
  shape_count = $slide.Shapes.Count
  texts = $texts
} | ConvertTo-Json -Compress -Depth 5
`);
  }

  async powerpointAddTextbox(
    slideNumber: number,
    text: string,
    left: number = 100,
    top: number = 100,
    width: number = 300,
    height: number = 50,
    options?: {
      fontName?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      fontColor?: string;
      alignment?: 'left' | 'center' | 'right' | 'justify';
      verticalAnchor?: 'top' | 'middle' | 'bottom';
    }
  ): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");

    // Build formatting commands
    const formatCmds: string[] = [];

    // Font name (auto-detect Korean if not specified)
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : undefined);
    if (fontName) formatCmds.push(`$textbox.TextFrame.TextRange.Font.Name = '${fontName}'`);

    if (options?.fontSize) formatCmds.push(`$textbox.TextFrame.TextRange.Font.Size = ${options.fontSize}`);
    if (options?.bold != null) formatCmds.push(`$textbox.TextFrame.TextRange.Font.Bold = ${options.bold ? '-1' : '0'}`);
    if (options?.italic != null) formatCmds.push(`$textbox.TextFrame.TextRange.Font.Italic = ${options.italic ? '-1' : '0'}`);

    if (options?.fontColor) {
      const hex = options.fontColor.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const rgb = r + g * 256 + b * 65536;
      formatCmds.push(`$textbox.TextFrame.TextRange.Font.Color.RGB = ${rgb}`);
    }

    const hAlignMap: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4 };
    if (options?.alignment && hAlignMap[options.alignment]) {
      formatCmds.push(`$textbox.TextFrame.TextRange.ParagraphFormat.Alignment = ${hAlignMap[options.alignment]}`);
    }

    const vAnchorMap: Record<string, number> = { top: 1, middle: 3, bottom: 4 };
    if (options?.verticalAnchor && vAnchorMap[options.verticalAnchor]) {
      formatCmds.push(`$textbox.TextFrame.VerticalAnchor = ${vAnchorMap[options.verticalAnchor]}`);
    }

    const formatScript = formatCmds.length > 0 ? formatCmds.join('\n') : '';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
# msoTextOrientationHorizontal = 1
$textbox = $slide.Shapes.AddTextbox(1, ${left}, ${top}, ${width}, ${height})
$textContent = '${escapedText}' -replace '\\\\n', [char]10 -replace '\\n', [char]10
$textbox.TextFrame.TextRange.Text = $textContent
${formatScript}
@{ success = $true; message = "Textbox added to slide ${slideNumber}"; shape_index = $textbox.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetFont(
    slideNumber: number,
    shapeIndex: number,
    options: {
      fontName?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];
    if (options.fontName) commands.push(`$textRange.Font.Name = '${options.fontName.replace(/'/g, "''")}'`);
    if (options.fontSize) commands.push(`$textRange.Font.Size = ${options.fontSize}`);
    if (options.bold !== undefined) commands.push(`$textRange.Font.Bold = ${options.bold ? '-1' : '0'}`);
    if (options.italic !== undefined) commands.push(`$textRange.Font.Italic = ${options.italic ? '-1' : '0'}`);
    if (options.color) {
      const rgb = this.hexToRgb(options.color);
      if (rgb) commands.push(`$textRange.Font.Color.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$textRange = $shape.TextFrame.TextRange
${commands.join('\n')}
@{ success = $true; message = "Font set for slide ${slideNumber}, shape ${shapeIndex}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddImage(
    slideNumber: number,
    imagePath: string,
    left: number = 100,
    top: number = 100,
    width?: number,
    height?: number
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(imagePath).replace(/'/g, "''");
    const sizeScript = width !== undefined && height !== undefined
      ? `$shape.Width = ${width}; $shape.Height = ${height}`
      : '';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes.AddPicture('${windowsPath}', 0, -1, ${left}, ${top})
${sizeScript}
@{ success = $true; message = "Image added to slide ${slideNumber}"; shape_index = $shape.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddShape(
    slideNumber: number,
    shapeType: 'rectangle' | 'oval' | 'triangle' | 'arrow' | 'star',
    left: number,
    top: number,
    width: number,
    height: number,
    fillColor?: string
  ): Promise<OfficeResponse> {
    // msoShapeRectangle=1, msoShapeOval=9, msoShapeIsoscelesTriangle=7, msoShapeRightArrow=33, msoShape5pointStar=92
    const shapeTypeMap: Record<string, number> = {
      rectangle: 1,
      oval: 9,
      triangle: 7,
      arrow: 33,
      star: 92
    };
    const shapeTypeNum = shapeTypeMap[shapeType] || 1;

    let fillScript = '';
    if (fillColor) {
      const rgb = this.hexToRgb(fillColor);
      if (rgb) fillScript = `$shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes.AddShape(${shapeTypeNum}, ${left}, ${top}, ${width}, ${height})
${fillScript}
@{ success = $true; message = "${shapeType} shape added to slide ${slideNumber}"; shape_index = $shape.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddAnimation(
    slideNumber: number,
    shapeIndex: number,
    effect: string = 'fade',
    trigger: string = 'on_click'
  ): Promise<OfficeResponse> {
    // Effect types: fade=3844, appear=3844, fly_in=3844, zoom=3845, wipe=3844
    const effectMap: Record<string, number> = {
      fade: 3844,
      appear: 1,
      fly_in: 3844,
      zoom: 3845,
      wipe: 22
    };
    // Trigger: on_click=1, with_previous=2, after_previous=3
    const triggerMap: Record<string, number> = {
      on_click: 1,
      with_previous: 2,
      after_previous: 3
    };

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$effect = $slide.TimeLine.MainSequence.AddEffect($shape, ${effectMap[effect] || 3844}, 0, ${triggerMap[trigger] || 1})
@{ success = $true; message = "Animation '${effect}' added to shape ${shapeIndex}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetTransition(
    slideNumber: number,
    transitionType: 'fade' | 'push' | 'wipe' | 'split' | 'reveal' | 'random' = 'fade',
    duration: number = 1
  ): Promise<OfficeResponse> {
    // Transition entry effects
    const transitionMap: Record<string, number> = {
      fade: 3849,
      push: 3846,
      wipe: 3851,
      split: 3848,
      reveal: 3850,
      random: 0
    };

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.SlideShowTransition.EntryEffect = ${transitionMap[transitionType]}
$slide.SlideShowTransition.Duration = ${duration}
@{ success = $true; message = "Transition '${transitionType}' set for slide ${slideNumber}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetBackground(
    slideNumber: number,
    options: { color?: string; imagePath?: string }
  ): Promise<OfficeResponse> {
    let bgScript = '';
    if (options.color) {
      const rgb = this.hexToRgb(options.color);
      if (rgb) {
        bgScript = `
$slide.FollowMasterBackground = 0
$slide.Background.Fill.Solid()
$slide.Background.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`;
      }
    } else if (options.imagePath) {
      const windowsPath = this.toWindowsPath(options.imagePath).replace(/'/g, "''");
      bgScript = `
$slide.FollowMasterBackground = 0
$slide.Background.Fill.UserPicture('${windowsPath}')`;
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
${bgScript}
@{ success = $true; message = "Background set for slide ${slideNumber}" } | ConvertTo-Json -Compress
`);
  }

  /**
   * Add a full-slide image as a picture shape covering the entire slide.
   * Creates picture at dummy size, then resizes with 20pt bleed to guarantee zero gap.
   * Deletes placeholder shapes from blank slide layout first.
   */
  async powerpointAddFullSlideImage(
    slideNumber: number,
    imagePath: string,
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(imagePath).replace(/'/g, "''");
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$w = $presentation.PageSetup.SlideWidth
$h = $presentation.PageSetup.SlideHeight
for ($s = $slide.Shapes.Count; $s -ge 1; $s--) { try { $slide.Shapes($s).Delete() } catch {} }
$pic = $slide.Shapes.AddPicture('${windowsPath}', 0, -1, 0, 0, $w, $h)
$pic.LockAspectRatio = 0
$pic.ZOrder(1)
@{ success = $true; message = "Full-slide image added to slide ${slideNumber}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetSlideCount(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
@{ success = $true; slide_count = $presentation.Slides.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointSave(filePath?: string): Promise<OfficeResponse> {
    const windowsPath = filePath ? this.toWindowsPath(filePath).replace(/'/g, "''") : '';
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
${windowsPath ? `$presentation.SaveAs('${windowsPath}')` : '$presentation.Save()'}
@{ success = $true; message = "Presentation saved"; path = $presentation.FullName } | ConvertTo-Json -Compress
`);
  }

  async powerpointExportToPDF(outputPath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(outputPath).replace(/'/g, "''");
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
# ppSaveAsPDF = 32
$presentation.SaveAs('${windowsPath}', 32)
@{ success = $true; message = "Exported to PDF"; path = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  async powerpointStartSlideshow(fromSlide: number = 1): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$settings = $presentation.SlideShowSettings
$settings.StartingSlide = ${fromSlide}
$settings.Run()
@{ success = $true; message = "Slideshow started from slide ${fromSlide}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointClose(save: boolean = false): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
${save ? '$presentation.Save()' : ''}
$presentation.Close()
@{ success = $true; message = "Presentation closed" } | ConvertTo-Json -Compress
`);
  }

  async powerpointQuit(save: boolean = false): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
${save ? `
foreach ($pres in $ppt.Presentations) {
  $pres.Save()
}` : ''}
$ppt.Quit()
@{ success = $true; message = "PowerPoint closed" } | ConvertTo-Json -Compress
`);
  }

  async powerpointScreenshot(): Promise<ScreenshotResponse> {
    const result = await this.executePowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides($ppt.ActiveWindow.View.Slide.SlideIndex)

# Export slide as JPEG for smaller context footprint
$tempPath = [System.IO.Path]::GetTempFileName() + ".jpg"
$slide.Export($tempPath, "JPG")

# Read and convert to base64
$bytes = [System.IO.File]::ReadAllBytes($tempPath)
$base64 = [Convert]::ToBase64String($bytes)

# Clean up
Remove-Item $tempPath -Force

@{
  success = $true
  image = $base64
  format = "jpeg"
  encoding = "base64"
} | ConvertTo-Json -Compress
`);
    return result as ScreenshotResponse;
  }

  // ===========================================================================
  // PowerPoint Advanced Features
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Table Functions
  // -------------------------------------------------------------------------

  async powerpointAddTable(
    slideNumber: number,
    rows: number,
    cols: number,
    left: number = 100,
    top: number = 100,
    width: number = 400,
    height: number = 200,
    data?: string[][]
  ): Promise<OfficeResponse> {
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
          const val = cellValue.replace(/'/g, "''");
          // IMPORTANT: Set text FIRST, then apply font to prevent garbled Korean
          dataLines.push(`$table.Cell(${i + 1}, ${j + 1}).Shape.TextFrame.TextRange.Text = ('${val}' -replace '\\\\n', [char]10 -replace '\\n', [char]10)`);
          if (cellHasKorean) {
            dataLines.push(`$table.Cell(${i + 1}, ${j + 1}).Shape.TextFrame.TextRange.Font.Name = 'Malgun Gothic'`);
          }
        }
      }
      dataScript = dataLines.join('\n');
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$table = $slide.Shapes.AddTable(${rows}, ${cols}, ${left}, ${top}, ${width}, ${height}).Table
${dataScript}
@{ success = $true; message = "Table added with ${rows} rows and ${cols} columns"; shape_index = $slide.Shapes.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetTableCell(
    slideNumber: number,
    shapeIndex: number,
    row: number,
    col: number,
    text: string,
    options?: { fontName?: string; fontSize?: number; bold?: boolean; fillColor?: string }
  ): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
    const fontName = options?.fontName || (hasKorean ? 'Malgun Gothic' : '');

    // IMPORTANT: Set text FIRST, then apply font formatting to prevent garbled Korean
    const formatCommands: string[] = [];
    if (fontName) formatCommands.push(`$cell.Shape.TextFrame.TextRange.Font.Name = '${fontName}'`);
    if (options?.fontSize) formatCommands.push(`$cell.Shape.TextFrame.TextRange.Font.Size = ${options.fontSize}`);
    if (options?.bold !== undefined) formatCommands.push(`$cell.Shape.TextFrame.TextRange.Font.Bold = ${options.bold ? '-1' : '0'}`);
    if (options?.fillColor) {
      const rgb = this.hexToRgb(options.fillColor);
      if (rgb) formatCommands.push(`$cell.Shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$cell = $table.Cell(${row}, ${col})
$textContent = '${escapedText}' -replace '\\\\n', [char]10 -replace '\\n', [char]10
$cell.Shape.TextFrame.TextRange.Text = $textContent
${formatCommands.join('\n')}
@{ success = $true; message = "Table cell (${row}, ${col}) updated" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetTableStyle(
    slideNumber: number,
    shapeIndex: number,
    options: {
      borderColor?: string;
      borderWidth?: number;
      headerRowFill?: string;
      alternateRowFill?: string;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.borderColor) {
      const rgb = this.hexToRgb(options.borderColor);
      if (rgb) {
        commands.push(`
for ($r = 1; $r -le $table.Rows.Count; $r++) {
  for ($c = 1; $c -le $table.Columns.Count; $c++) {
    $cell = $table.Cell($r, $c)
    $cell.Borders(1).ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
    $cell.Borders(2).ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
    $cell.Borders(3).ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
    $cell.Borders(4).ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
  }
}`);
      }
    }

    if (options.headerRowFill) {
      const rgb = this.hexToRgb(options.headerRowFill);
      if (rgb) {
        commands.push(`
for ($c = 1; $c -le $table.Columns.Count; $c++) {
  $table.Cell(1, $c).Shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
}`);
      }
    }

    if (options.alternateRowFill) {
      const rgb = this.hexToRgb(options.alternateRowFill);
      if (rgb) {
        commands.push(`
for ($r = 2; $r -le $table.Rows.Count; $r += 2) {
  for ($c = 1; $c -le $table.Columns.Count; $c++) {
    $table.Cell($r, $c).Shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}
  }
}`);
      }
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
${commands.join('\n')}
@{ success = $true; message = "Table style updated" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Shape Management Functions
  // -------------------------------------------------------------------------

  async powerpointDeleteShape(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.Shapes(${shapeIndex}).Delete()
@{ success = $true; message = "Shape ${shapeIndex} deleted from slide ${slideNumber}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointDuplicateShape(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$newShape = $slide.Shapes(${shapeIndex}).Duplicate()
@{ success = $true; message = "Shape duplicated"; new_shape_index = $newShape.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointRotateShape(slideNumber: number, shapeIndex: number, angle: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.Rotation = ${angle}
@{ success = $true; message = "Shape rotated to ${angle} degrees" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetShapeInfo(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
@{
  success = $true
  name = $shape.Name
  type = $shape.Type
  left = $shape.Left
  top = $shape.Top
  width = $shape.Width
  height = $shape.Height
  rotation = $shape.Rotation
  visible = $shape.Visible
  has_text = $shape.HasTextFrame
} | ConvertTo-Json -Compress
`);
  }

  async powerpointSetShapeName(slideNumber: number, shapeIndex: number, name: string): Promise<OfficeResponse> {
    const escapedName = name.replace(/'/g, "''");
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.Name = '${escapedName}'
@{ success = $true; message = "Shape name set to '${escapedName}'" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetShapeOpacity(slideNumber: number, shapeIndex: number, opacity: number): Promise<OfficeResponse> {
    // opacity: 0-100 (0 = fully transparent, 100 = fully opaque)
    const transparency = 1 - (opacity / 100);
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.Fill.Transparency = ${transparency}
@{ success = $true; message = "Shape opacity set to ${opacity}%" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetShapeList(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shapes = @()
for ($i = 1; $i -le $slide.Shapes.Count; $i++) {
  $s = $slide.Shapes($i)
  $shapes += @{
    index = $i
    name = $s.Name
    type = $s.Type
    left = $s.Left
    top = $s.Top
    width = $s.Width
    height = $s.Height
  }
}
@{ success = $true; slide = ${slideNumber}; count = $slide.Shapes.Count; shapes = $shapes } | ConvertTo-Json -Compress -Depth 5
`);
  }

  // -------------------------------------------------------------------------
  // Shape Position/Size/Style Functions
  // -------------------------------------------------------------------------

  async powerpointSetShapePosition(
    slideNumber: number,
    shapeIndex: number,
    left: number,
    top: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.Left = ${left}
$shape.Top = ${top}
@{ success = $true; message = "Shape position set to (${left}, ${top})" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetShapeSize(
    slideNumber: number,
    shapeIndex: number,
    width: number,
    height: number,
    lockAspectRatio: boolean = false
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.LockAspectRatio = ${lockAspectRatio ? '-1' : '0'}
$shape.Width = ${width}
$shape.Height = ${height}
@{ success = $true; message = "Shape size set to ${width}x${height}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetShapeStyle(
    slideNumber: number,
    shapeIndex: number,
    options: {
      fillColor?: string;
      fillTransparency?: number;
      lineColor?: string;
      lineWeight?: number;
      lineStyle?: 'solid' | 'dash' | 'dot' | 'dashDot';
      noFill?: boolean;
      noLine?: boolean;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.noFill) {
      commands.push('$shape.Fill.Visible = 0');
    } else if (options.fillColor) {
      const rgb = this.hexToRgb(options.fillColor);
      if (rgb) {
        commands.push('$shape.Fill.Visible = -1');
        commands.push('$shape.Fill.Solid()');
        commands.push(`$shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
    }

    if (options.fillTransparency !== undefined) {
      commands.push(`$shape.Fill.Transparency = ${options.fillTransparency / 100}`);
    }

    if (options.noLine) {
      commands.push('$shape.Line.Visible = 0');
    } else {
      if (options.lineColor) {
        const rgb = this.hexToRgb(options.lineColor);
        if (rgb) {
          commands.push('$shape.Line.Visible = -1');
          commands.push(`$shape.Line.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
        }
      }
      if (options.lineWeight !== undefined) {
        commands.push(`$shape.Line.Weight = ${options.lineWeight}`);
      }
      if (options.lineStyle) {
        const styleMap: Record<string, number> = { solid: 1, dash: 4, dot: 2, dashDot: 5 };
        commands.push(`$shape.Line.DashStyle = ${styleMap[options.lineStyle]}`);
      }
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Shape style updated" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Z-Order Functions
  // -------------------------------------------------------------------------

  async powerpointBringToFront(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.ZOrder(0)  # msoBringToFront = 0
@{ success = $true; message = "Shape brought to front" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSendToBack(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.ZOrder(1)  # msoSendToBack = 1
@{ success = $true; message = "Shape sent to back" } | ConvertTo-Json -Compress
`);
  }

  async powerpointBringForward(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.ZOrder(2)  # msoBringForward = 2
@{ success = $true; message = "Shape brought forward" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSendBackward(slideNumber: number, shapeIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.ZOrder(3)  # msoSendBackward = 3
@{ success = $true; message = "Shape sent backward" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Alignment Functions
  // -------------------------------------------------------------------------

  async powerpointAlignShapes(
    slideNumber: number,
    shapeIndices: number[],
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ): Promise<OfficeResponse> {
    const alignMap: Record<string, number> = {
      left: 0,    // msoAlignLefts
      center: 1,  // msoAlignCenters
      right: 2,   // msoAlignRights
      top: 3,     // msoAlignTops
      middle: 4,  // msoAlignMiddles
      bottom: 5,  // msoAlignBottoms
    };

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shapeRange = $slide.Shapes.Range(@(${shapeIndices.join(', ')}))
$shapeRange.Align(${alignMap[alignment]}, 0)  # 0 = msoFalse (relative to slide)
@{ success = $true; message = "Shapes aligned to ${alignment}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointDistributeShapes(
    slideNumber: number,
    shapeIndices: number[],
    direction: 'horizontal' | 'vertical'
  ): Promise<OfficeResponse> {
    const distributeType = direction === 'horizontal' ? 0 : 1; // msoDistributeHorizontally = 0, msoDistributeVertically = 1

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shapeRange = $slide.Shapes.Range(@(${shapeIndices.join(', ')}))
$shapeRange.Distribute(${distributeType}, 0)
@{ success = $true; message = "Shapes distributed ${direction}ly" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Slide Management Functions
  // -------------------------------------------------------------------------

  async powerpointSetSlideLayout(slideNumber: number, layoutIndex: number): Promise<OfficeResponse> {
    // Common layouts: 1=Title, 2=Title+Content, 3=Section Header, 4=Two Content, 5=Comparison, 6=Title Only, 7=Blank
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.Layout = ${layoutIndex}
@{ success = $true; message = "Slide layout set to ${layoutIndex}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointDuplicateSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$newSlide = $presentation.Slides(${slideNumber}).Duplicate()
@{ success = $true; message = "Slide ${slideNumber} duplicated"; new_slide_index = $newSlide.SlideIndex } | ConvertTo-Json -Compress
`);
  }

  async powerpointHideSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.SlideShowTransition.Hidden = -1
@{ success = $true; message = "Slide ${slideNumber} hidden" } | ConvertTo-Json -Compress
`);
  }

  async powerpointShowSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.SlideShowTransition.Hidden = 0
@{ success = $true; message = "Slide ${slideNumber} shown" } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddSection(sectionName: string, beforeSlide: number): Promise<OfficeResponse> {
    const escapedName = sectionName.replace(/'/g, "''");
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$sectionIndex = $presentation.SectionProperties.AddBeforeSlide(${beforeSlide}, '${escapedName}')
@{ success = $true; message = "Section '${escapedName}' added"; section_index = $sectionIndex } | ConvertTo-Json -Compress
`);
  }

  async powerpointDeleteSection(sectionIndex: number, deleteSlides: boolean = false): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$presentation.SectionProperties.Delete(${sectionIndex}, ${deleteSlides ? '-1' : '0'})
@{ success = $true; message = "Section ${sectionIndex} deleted" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetSections(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$sections = @()
for ($i = 1; $i -le $presentation.SectionProperties.Count; $i++) {
  $sections += @{
    index = $i
    name = $presentation.SectionProperties.Name($i)
    firstSlide = $presentation.SectionProperties.FirstSlide($i)
    slideCount = $presentation.SectionProperties.SlidesCount($i)
  }
}
@{ success = $true; count = $presentation.SectionProperties.Count; sections = $sections } | ConvertTo-Json -Compress -Depth 5
`);
  }

  // -------------------------------------------------------------------------
  // Notes Functions
  // -------------------------------------------------------------------------

  async powerpointAddNote(slideNumber: number, noteText: string): Promise<OfficeResponse> {
    const escapedText = noteText.replace(/'/g, "''");
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(noteText);

    // IMPORTANT: Set text FIRST, then apply font to prevent garbled Korean
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$noteRange = $slide.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange
$textContent = '${escapedText}' -replace '\\\\n', [char]10 -replace '\\n', [char]10
$noteRange.Text = $textContent
${hasKorean ? "$noteRange.Font.Name = 'Malgun Gothic'" : ''}
@{ success = $true; message = "Note added to slide ${slideNumber}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetNote(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$noteText = $slide.NotesPage.Shapes.Placeholders(2).TextFrame.TextRange.Text
@{ success = $true; slide = ${slideNumber}; note = $noteText } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Grouping Functions
  // -------------------------------------------------------------------------

  async powerpointGroupShapes(slideNumber: number, shapeIndices: number[]): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shapeRange = $slide.Shapes.Range(@(${shapeIndices.join(', ')}))
$group = $shapeRange.Group()
@{ success = $true; message = "Shapes grouped"; group_index = $group.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointUngroupShapes(slideNumber: number, groupIndex: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$group = $slide.Shapes(${groupIndex})
$shapeRange = $group.Ungroup()
@{ success = $true; message = "Group ungrouped"; shape_count = $shapeRange.Count } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Text Formatting Functions
  // -------------------------------------------------------------------------

  async powerpointSetTextAlignment(
    slideNumber: number,
    shapeIndex: number,
    horizontal: 'left' | 'center' | 'right' | 'justify',
    vertical?: 'top' | 'middle' | 'bottom'
  ): Promise<OfficeResponse> {
    const hAlignMap: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4 };
    const vAlignMap: Record<string, number> = { top: 1, middle: 3, bottom: 4 };

    const commands: string[] = [];
    commands.push(`$shape.TextFrame.TextRange.ParagraphFormat.Alignment = ${hAlignMap[horizontal]}`);
    if (vertical) {
      commands.push(`$shape.TextFrame.VerticalAnchor = ${vAlignMap[vertical]}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Text alignment set" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetBulletList(
    slideNumber: number,
    shapeIndex: number,
    bulletType: 'none' | 'bullet' | 'numbered',
    bulletChar?: string
  ): Promise<OfficeResponse> {
    const typeMap: Record<string, number> = { none: 0, bullet: 1, numbered: 2 };

    let bulletScript = `$shape.TextFrame.TextRange.ParagraphFormat.Bullet.Type = ${typeMap[bulletType]}`;
    if (bulletType === 'bullet' && bulletChar) {
      bulletScript += `\n$shape.TextFrame.TextRange.ParagraphFormat.Bullet.Character = [int][char]'${bulletChar}'`;
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${bulletScript}
@{ success = $true; message = "Bullet style set to ${bulletType}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetLineSpacing(
    slideNumber: number,
    shapeIndex: number,
    lineSpacing: number,
    spaceAfter?: number,
    spaceBefore?: number
  ): Promise<OfficeResponse> {
    const commands: string[] = [];
    commands.push(`$shape.TextFrame.TextRange.ParagraphFormat.LineRuleWithin = 0`); // Use exact spacing
    commands.push(`$shape.TextFrame.TextRange.ParagraphFormat.SpaceWithin = ${lineSpacing}`);
    if (spaceAfter !== undefined) {
      commands.push(`$shape.TextFrame.TextRange.ParagraphFormat.SpaceAfter = ${spaceAfter}`);
    }
    if (spaceBefore !== undefined) {
      commands.push(`$shape.TextFrame.TextRange.ParagraphFormat.SpaceBefore = ${spaceBefore}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Line spacing set to ${lineSpacing}" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetTextboxBorder(
    slideNumber: number,
    shapeIndex: number,
    options: {
      color?: string;
      weight?: number;
      style?: 'solid' | 'dash' | 'dot';
      visible?: boolean;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.visible === false) {
      commands.push('$shape.Line.Visible = 0');
    } else {
      commands.push('$shape.Line.Visible = -1');
      if (options.color) {
        const rgb = this.hexToRgb(options.color);
        if (rgb) commands.push(`$shape.Line.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
      if (options.weight !== undefined) commands.push(`$shape.Line.Weight = ${options.weight}`);
      if (options.style) {
        const styleMap: Record<string, number> = { solid: 1, dash: 4, dot: 2 };
        commands.push(`$shape.Line.DashStyle = ${styleMap[options.style]}`);
      }
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Textbox border updated" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetTextboxFill(
    slideNumber: number,
    shapeIndex: number,
    options: {
      color?: string;
      transparency?: number;
      visible?: boolean;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.visible === false) {
      commands.push('$shape.Fill.Visible = 0');
    } else {
      commands.push('$shape.Fill.Visible = -1');
      commands.push('$shape.Fill.Solid()');
      if (options.color) {
        const rgb = this.hexToRgb(options.color);
        if (rgb) commands.push(`$shape.Fill.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
      if (options.transparency !== undefined) {
        commands.push(`$shape.Fill.Transparency = ${options.transparency / 100}`);
      }
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Textbox fill updated" } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Media Functions
  // -------------------------------------------------------------------------

  async powerpointAddHyperlink(
    slideNumber: number,
    shapeIndex: number,
    url: string,
    screenTip?: string
  ): Promise<OfficeResponse> {
    const escapedUrl = url.replace(/'/g, "''");
    const escapedTip = screenTip?.replace(/'/g, "''") || '';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$link = $shape.ActionSettings(1).Hyperlink
$link.Address = '${escapedUrl}'
${escapedTip ? `$link.ScreenTip = '${escapedTip}'` : ''}
@{ success = $true; message = "Hyperlink added to shape" } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddVideo(
    slideNumber: number,
    videoPath: string,
    left: number = 100,
    top: number = 100,
    width: number = 400,
    height: number = 300
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(videoPath).replace(/'/g, "''");

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$video = $slide.Shapes.AddMediaObject2('${windowsPath}', 0, -1, ${left}, ${top}, ${width}, ${height})
@{ success = $true; message = "Video added to slide ${slideNumber}"; shape_index = $video.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddAudio(
    slideNumber: number,
    audioPath: string,
    left: number = 100,
    top: number = 100,
    playInBackground: boolean = false
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(audioPath).replace(/'/g, "''");

    const bgScript = playInBackground ? `
$audio.AnimationSettings.PlaySettings.PlayOnEntry = -1
$audio.AnimationSettings.PlaySettings.HideWhileNotPlaying = -1
$audio.AnimationSettings.PlaySettings.LoopUntilStopped = 0
` : '';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$audio = $slide.Shapes.AddMediaObject2('${windowsPath}', 0, -1, ${left}, ${top})
${bgScript}
@{ success = $true; message = "Audio added to slide ${slideNumber}"; shape_index = $audio.Index } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddChart(
    slideNumber: number,
    chartType: 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter',
    left: number = 100,
    top: number = 100,
    width: number = 400,
    height: number = 300,
    data?: { categories: string[]; series: { name: string; values: number[] }[] }
  ): Promise<OfficeResponse> {
    const chartTypeMap: Record<string, number> = {
      column: 51,  // xlColumnClustered
      bar: 57,     // xlBarClustered
      line: 4,     // xlLine
      pie: 5,      // xlPie
      area: 1,     // xlArea
      scatter: -4169,  // xlXYScatter
    };

    let dataScript = '';
    if (data) {
      const rows = data.series.length + 1;
      const cols = data.categories.length + 1;
      dataScript = `
$chart.ChartData.Activate()
$workbook = $chart.ChartData.Workbook
$sheet = $workbook.Worksheets(1)
$sheet.Cells.Clear()
`;
      // Add categories
      for (let i = 0; i < data.categories.length; i++) {
        const cat = data.categories[i]?.replace(/'/g, "''") || '';
        dataScript += `$sheet.Cells(1, ${i + 2}).Value = '${cat}'\n`;
      }
      // Add series
      for (let s = 0; s < data.series.length; s++) {
        const series = data.series[s];
        if (!series) continue;
        dataScript += `$sheet.Cells(${s + 2}, 1).Value = '${series.name.replace(/'/g, "''")}'\n`;
        for (let v = 0; v < series.values.length; v++) {
          dataScript += `$sheet.Cells(${s + 2}, ${v + 2}).Value = ${series.values[v]}\n`;
        }
      }
      dataScript += `
$chart.SetSourceData($sheet.Range($sheet.Cells(1,1), $sheet.Cells(${rows}, ${cols})))
$workbook.Close()
`;
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$chart = $slide.Shapes.AddChart2(-1, ${chartTypeMap[chartType]}, ${left}, ${top}, ${width}, ${height}).Chart
${dataScript}
@{ success = $true; message = "${chartType} chart added to slide ${slideNumber}"; shape_index = $slide.Shapes.Count } | ConvertTo-Json -Compress
`);
  }

  // -------------------------------------------------------------------------
  // Effects Functions
  // -------------------------------------------------------------------------

  async powerpointSetShadow(
    slideNumber: number,
    shapeIndex: number,
    options: {
      visible?: boolean;
      type?: 'outer' | 'inner';
      color?: string;
      blur?: number;
      offsetX?: number;
      offsetY?: number;
      transparency?: number;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.visible === false) {
      commands.push('$shape.Shadow.Visible = 0');
    } else {
      commands.push('$shape.Shadow.Visible = -1');
      if (options.type === 'inner') {
        commands.push('$shape.Shadow.Type = 21'); // msoShadowStyleInnerShadow
      } else {
        commands.push('$shape.Shadow.Type = 1'); // msoShadowStyleOuterShadow
      }
      if (options.color) {
        const rgb = this.hexToRgb(options.color);
        if (rgb) commands.push(`$shape.Shadow.ForeColor.RGB = ${rgb.r + rgb.g * 256 + rgb.b * 65536}`);
      }
      if (options.blur !== undefined) commands.push(`$shape.Shadow.Blur = ${options.blur}`);
      if (options.offsetX !== undefined) commands.push(`$shape.Shadow.OffsetX = ${options.offsetX}`);
      if (options.offsetY !== undefined) commands.push(`$shape.Shadow.OffsetY = ${options.offsetY}`);
      if (options.transparency !== undefined) commands.push(`$shape.Shadow.Transparency = ${options.transparency / 100}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Shadow effect updated" } | ConvertTo-Json -Compress
`);
  }

  async powerpointSetReflection(
    slideNumber: number,
    shapeIndex: number,
    options: {
      visible?: boolean;
      type?: number;  // 1-9 reflection types
      blur?: number;
      offset?: number;
      size?: number;
      transparency?: number;
    }
  ): Promise<OfficeResponse> {
    const commands: string[] = [];

    if (options.visible === false) {
      commands.push('$shape.Reflection.Type = 0'); // msoReflectionTypeNone
    } else {
      commands.push(`$shape.Reflection.Type = ${options.type || 1}`);
      if (options.blur !== undefined) commands.push(`$shape.Reflection.Blur = ${options.blur}`);
      if (options.offset !== undefined) commands.push(`$shape.Reflection.Offset = ${options.offset}`);
      if (options.size !== undefined) commands.push(`$shape.Reflection.Size = ${options.size}`);
      if (options.transparency !== undefined) commands.push(`$shape.Reflection.Transparency = ${options.transparency / 100}`);
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
${commands.join('\n')}
@{ success = $true; message = "Reflection effect updated" } | ConvertTo-Json -Compress
`);
  }

  async powerpointApplyTheme(themePath: string): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(themePath).replace(/'/g, "''");

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$presentation.ApplyTheme('${windowsPath}')
@{ success = $true; message = "Theme applied" } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetThemes(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$themesPath = [Environment]::GetFolderPath('CommonDocuments') + '\\Microsoft\\Templates\\Document Themes'
$themes = @()
if (Test-Path $themesPath) {
  Get-ChildItem -Path $themesPath -Filter "*.thmx" | ForEach-Object {
    $themes += @{ name = $_.BaseName; path = $_.FullName }
  }
}
# Also check user themes
$userThemesPath = [Environment]::GetFolderPath('MyDocuments') + '\\Custom Office Templates'
if (Test-Path $userThemesPath) {
  Get-ChildItem -Path $userThemesPath -Filter "*.thmx" -ErrorAction SilentlyContinue | ForEach-Object {
    $themes += @{ name = $_.BaseName; path = $_.FullName }
  }
}
@{ success = $true; themes = $themes } | ConvertTo-Json -Compress -Depth 5
`);
  }

  // -------------------------------------------------------------------------
  // Placeholder Functions
  // -------------------------------------------------------------------------

  async powerpointSetPlaceholderText(
    slideNumber: number,
    placeholderType: 'title' | 'subtitle' | 'body' | 'footer' | 'slideNumber' | 'date',
    text: string
  ): Promise<OfficeResponse> {
    const escapedText = text.replace(/'/g, "''");
    const hasKorean = /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);

    // ppPlaceholderType values
    const typeMap: Record<string, number> = {
      title: 1,
      subtitle: 4,
      body: 2,
      footer: 5,
      slideNumber: 6,
      date: 16,
    };

    // IMPORTANT: Set text FIRST, then apply font to prevent garbled Korean
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$placeholder = $null
foreach ($shape in $slide.Shapes) {
  if ($shape.Type -eq 14) {  # msoPlaceholder
    if ($shape.PlaceholderFormat.Type -eq ${typeMap[placeholderType]}) {
      $placeholder = $shape
      break
    }
  }
}
if ($placeholder) {
  $textContent = '${escapedText}' -replace '\\\\n', [char]10 -replace '\\n', [char]10
  $placeholder.TextFrame.TextRange.Text = $textContent
  ${hasKorean ? "$placeholder.TextFrame.TextRange.Font.Name = 'Malgun Gothic'" : ''}
  @{ success = $true; message = "${placeholderType} placeholder text set" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "Placeholder type '${placeholderType}' not found on slide ${slideNumber}" } | ConvertTo-Json -Compress
}
`);
  }

  async powerpointGetPlaceholders(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$placeholders = @()
foreach ($shape in $slide.Shapes) {
  if ($shape.Type -eq 14) {  # msoPlaceholder
    $placeholders += @{
      index = $shape.Index
      name = $shape.Name
      type = $shape.PlaceholderFormat.Type
      hasText = $shape.HasTextFrame
      text = if ($shape.HasTextFrame -eq -1) { $shape.TextFrame.TextRange.Text } else { "" }
    }
  }
}
@{ success = $true; slide = ${slideNumber}; placeholders = $placeholders } | ConvertTo-Json -Compress -Depth 5
`);
  }

  async powerpointGetSlideLayouts(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$layouts = @()
$master = $presentation.SlideMaster
for ($i = 1; $i -le $master.CustomLayouts.Count; $i++) {
  $layout = $master.CustomLayouts($i)
  $layouts += @{
    index = $i
    name = $layout.Name
  }
}
@{ success = $true; layouts = $layouts } | ConvertTo-Json -Compress -Depth 5
`);
  }

  // ===========================================================================
  // Table Advanced Operations
  // ===========================================================================

  async powerpointMergeTableCells(
    slideNumber: number,
    shapeIndex: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$cell1 = $table.Cell(${startRow}, ${startCol})
$cell2 = $table.Cell(${endRow}, ${endCol})
$cell1.Merge($cell2)
@{ success = $true; message = "Cells merged from (${startRow},${startCol}) to (${endRow},${endCol})" } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddTableRow(
    slideNumber: number,
    shapeIndex: number,
    position?: number
  ): Promise<OfficeResponse> {
    const posScript = position ? `${position}` : '$table.Rows.Count + 1';
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$pos = ${posScript}
$table.Rows.Add($pos)
@{ success = $true; message = "Row added at position $pos"; row_count = $table.Rows.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointAddTableColumn(
    slideNumber: number,
    shapeIndex: number,
    position?: number
  ): Promise<OfficeResponse> {
    const posScript = position ? `${position}` : '$table.Columns.Count + 1';
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$pos = ${posScript}
$table.Columns.Add($pos)
@{ success = $true; message = "Column added at position $pos"; column_count = $table.Columns.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointDeleteTableRow(
    slideNumber: number,
    shapeIndex: number,
    rowIndex: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$table.Rows(${rowIndex}).Delete()
@{ success = $true; message = "Row ${rowIndex} deleted"; row_count = $table.Rows.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointDeleteTableColumn(
    slideNumber: number,
    shapeIndex: number,
    colIndex: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$table.Columns(${colIndex}).Delete()
@{ success = $true; message = "Column ${colIndex} deleted"; column_count = $table.Columns.Count } | ConvertTo-Json -Compress
`);
  }

  async powerpointGetTableInfo(
    slideNumber: number,
    shapeIndex: number
  ): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$table = $slide.Shapes(${shapeIndex}).Table
$cells = @()
for ($r = 1; $r -le $table.Rows.Count; $r++) {
  for ($c = 1; $c -le $table.Columns.Count; $c++) {
    try {
      $cell = $table.Cell($r, $c)
      $cells += @{
        row = $r
        col = $c
        text = $cell.Shape.TextFrame.TextRange.Text
      }
    } catch {}
  }
}
@{
  success = $true
  rows = $table.Rows.Count
  columns = $table.Columns.Count
  cells = $cells
} | ConvertTo-Json -Compress -Depth 5
`);
  }

  // ===========================================================================
  // Text Find/Replace
  // ===========================================================================

  async powerpointFindReplaceText(
    findText: string,
    replaceText: string,
    options?: { slideNumber?: number; matchCase?: boolean }
  ): Promise<OfficeResponse> {
    const escapedFind = findText.replace(/'/g, "''");
    const escapedReplace = replaceText.replace(/'/g, "''");
    const slideFilter = options?.slideNumber ? `Where-Object { $_.SlideIndex -eq ${options.slideNumber} }` : '';
    const matchCase = options?.matchCase ? '$true' : '$false';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$count = 0
$slides = $presentation.Slides | ${slideFilter || 'ForEach-Object { $_ }'}
foreach ($slide in $slides) {
  foreach ($shape in $slide.Shapes) {
    if ($shape.HasTextFrame -eq -1) {
      $text = $shape.TextFrame.TextRange.Text
      if ($text -match [regex]::Escape('${escapedFind}')) {
        if (${matchCase}) {
          $newText = $text -creplace [regex]::Escape('${escapedFind}'), '${escapedReplace}'
        } else {
          $newText = $text -ireplace [regex]::Escape('${escapedFind}'), '${escapedReplace}'
        }
        $shape.TextFrame.TextRange.Text = $newText
        $count++
      }
    }
  }
}
@{ success = $true; message = "Replaced $count occurrence(s)"; replacements = $count } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Shape Flip
  // ===========================================================================

  async powerpointFlipShape(
    slideNumber: number,
    shapeIndex: number,
    direction: 'horizontal' | 'vertical'
  ): Promise<OfficeResponse> {
    // msoFlipHorizontal = 0, msoFlipVertical = 1
    const flipType = direction === 'horizontal' ? 0 : 1;
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$slide = $ppt.ActivePresentation.Slides(${slideNumber})
$shape = $slide.Shapes(${shapeIndex})
$shape.Flip(${flipType})
@{ success = $true; message = "Shape flipped ${direction}" } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Slideshow Control
  // ===========================================================================

  async powerpointStopSlideshow(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
if ($ppt.SlideShowWindows.Count -gt 0) {
  $ppt.SlideShowWindows(1).View.Exit()
  @{ success = $true; message = "Slideshow stopped" } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "No slideshow is running" } | ConvertTo-Json -Compress
}
`);
  }

  async powerpointGotoSlide(slideNumber: number): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
if ($ppt.SlideShowWindows.Count -gt 0) {
  $ppt.SlideShowWindows(1).View.GotoSlide(${slideNumber})
  @{ success = $true; message = "Navigated to slide ${slideNumber}" } | ConvertTo-Json -Compress
} else {
  # Not in slideshow mode, just select the slide
  $ppt.ActivePresentation.Slides(${slideNumber}).Select()
  @{ success = $true; message = "Selected slide ${slideNumber}" } | ConvertTo-Json -Compress
}
`);
  }

  // ===========================================================================
  // Presentation Info
  // ===========================================================================

  async powerpointGetPresentationInfo(): Promise<OfficeResponse> {
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$p = $ppt.ActivePresentation
@{
  success = $true
  name = $p.Name
  path = $p.FullName
  slide_count = $p.Slides.Count
  slide_width = $p.PageSetup.SlideWidth
  slide_height = $p.PageSetup.SlideHeight
  saved = $p.Saved
  readonly = $p.ReadOnly
  has_title_master = $p.HasTitleMaster
} | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Copy Shape (to same or different slide)
  // ===========================================================================

  async powerpointCopyShape(
    sourceSlide: number,
    shapeIndex: number,
    targetSlide?: number
  ): Promise<OfficeResponse> {
    const target = targetSlide || sourceSlide;
    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$srcSlide = $presentation.Slides(${sourceSlide})
$shape = $srcSlide.Shapes(${shapeIndex})
$shape.Copy()
$dstSlide = $presentation.Slides(${target})
$newShape = $dstSlide.Shapes.Paste()
@{
  success = $true
  message = "Shape copied to slide ${target}"
  new_shape_index = $newShape.ZOrderPosition
} | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Export Slide as Image
  // ===========================================================================

  async powerpointExportSlideAsImage(
    slideNumber: number,
    outputPath: string,
    format: 'png' | 'jpg' = 'png',
    width?: number,
    height?: number
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(outputPath).replace(/'/g, "''");
    const formatUpper = format.toUpperCase();
    const sizeParams = width && height ? `, ${width}, ${height}` : '';

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$slide = $presentation.Slides(${slideNumber})
$slide.Export('${windowsPath}', '${formatUpper}'${sizeParams})
@{ success = $true; message = "Slide ${slideNumber} exported as ${format}"; path = '${windowsPath}' } | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Import Slides from Another Presentation
  // ===========================================================================

  async powerpointImportSlides(
    sourcePath: string,
    slideRange?: { start?: number; end?: number },
    insertPosition?: number
  ): Promise<OfficeResponse> {
    const windowsPath = this.toWindowsPath(sourcePath).replace(/'/g, "''");
    const insertAt = insertPosition || -1; // -1 means append at end

    let rangeScript = '';
    if (slideRange?.start && slideRange?.end) {
      rangeScript = `
$startSlide = ${slideRange.start}
$endSlide = ${slideRange.end}`;
    } else {
      rangeScript = `
$startSlide = 1
$endSlide = $sourcePresentation.Slides.Count`;
    }

    return this.executePowerShell(`
$ppt = [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
$presentation = $ppt.ActivePresentation
$sourcePresentation = $ppt.Presentations.Open('${windowsPath}', $true, $false, $false)
${rangeScript}
$insertPos = ${insertAt}
if ($insertPos -eq -1) { $insertPos = $presentation.Slides.Count + 1 }
$importedCount = 0
for ($i = $startSlide; $i -le $endSlide; $i++) {
  $sourceSlide = $sourcePresentation.Slides($i)
  $sourceSlide.Copy()
  $presentation.Slides.Paste($insertPos + $importedCount)
  $importedCount++
}
$sourcePresentation.Close()
@{
  success = $true
  message = "Imported $importedCount slide(s) from source presentation"
  imported_count = $importedCount
  insert_position = $insertPos
} | ConvertTo-Json -Compress
`);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Render an HTML file to PNG using Edge headless screenshot.
   * Both paths must be Windows-format (e.g., C:\temp\slide.html).
   */
  async renderHtmlToImage(
    htmlWindowsPath: string,
    imageWindowsPath: string,
  ): Promise<OfficeResponse> {
    const safeHtml = htmlWindowsPath.replace(/'/g, "''");
    const safePng = imageWindowsPath.replace(/'/g, "''");
    return this.executePowerShell(`
$edgePath = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edgePath -or -not (Test-Path $edgePath)) {
  $candidates = @(
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  )
  $edgePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $edgePath) {
  $chromePath = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
  if (-not $chromePath -or -not (Test-Path $chromePath)) {
    $chromeCandidates = @(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    )
    $chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if ($chromePath) { $edgePath = $chromePath }
  else { throw 'Neither Microsoft Edge nor Google Chrome found' }
}

$htmlFile = '${safeHtml}'
$pngFile = '${safePng}'
$fileUrl = 'file:///' + ($htmlFile -replace '\\\\', '/')

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $edgePath
$rawPng = $pngFile + '.raw.png'
$psi.Arguments = "--headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --window-size=2040,1200 --screenshot=$rawPng $fileUrl"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit(15000)

if (-not (Test-Path $rawPng)) {
  throw "Screenshot not created. Exit code: $($proc.ExitCode)"
}

# Crop from 2040x1200 to 1920x1080 (removes Edge headless gradient edge gap)
Add-Type -AssemblyName System.Drawing
$raw = [System.Drawing.Bitmap]::new($rawPng)
$cropped = New-Object System.Drawing.Bitmap(1920, 1080)
$g = [System.Drawing.Graphics]::FromImage($cropped)
$g.DrawImage($raw, 0, 0, [System.Drawing.Rectangle]::new(0, 0, 1920, 1080), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$cropped.Save($pngFile, [System.Drawing.Imaging.ImageFormat]::Png)
$raw.Dispose()
$cropped.Dispose()
Remove-Item $rawPng -Force -ErrorAction SilentlyContinue

@{ success = $true; image_path = $pngFile } | ConvertTo-Json -Compress
`);
  }

  /**
   * Measure the natural content height of an HTML file using Edge --dump-dom.
   * The HTML must have a <script> that sets document.title = 'SH:' + scrollHeight.
   * Returns the scrollHeight in pixels, or -1 on failure.
   */
  async measureHtmlHeight(htmlWindowsPath: string): Promise<number> {
    const safeHtml = htmlWindowsPath.replace(/'/g, "''");
    try {
      const result = await this.executePowerShell(`
$edgePath = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edgePath -or -not (Test-Path $edgePath)) {
  $candidates = @(
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  )
  $edgePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $edgePath) {
  $chromePath = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
  if (-not $chromePath -or -not (Test-Path $chromePath)) {
    $chromeCandidates = @(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    )
    $chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if ($chromePath) { $edgePath = $chromePath }
  else { throw 'Neither Microsoft Edge nor Google Chrome found' }
}

$htmlFile = '${safeHtml}'
$fileUrl = 'file:///' + ($htmlFile -replace '\\\\', '/')

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $edgePath
$psi.Arguments = "--headless=new --disable-gpu --no-sandbox --dump-dom $fileUrl"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$proc = [System.Diagnostics.Process]::Start($psi)
$output = $proc.StandardOutput.ReadToEnd()
$proc.StandardError.ReadToEnd() | Out-Null
if (-not $proc.WaitForExit(15000)) { try { $proc.Kill() } catch {} }

# Match title tag specifically — avoids encoding issues with full-output regex
$height = -1
if ($output -match '<title>SH:(\\d+)</title>') {
  $height = [int]$Matches[1]
} elseif ($output -match 'SH:(\\d+)') {
  $height = [int]$Matches[1]
}
if ($height -gt 0) {
  @{ success = $true; height = $height } | ConvertTo-Json -Compress
} else {
  @{ success = $false; height = -1 } | ConvertTo-Json -Compress
}
`);
      if (result.success) {
        const height = (result as Record<string, unknown>)['height'];
        return typeof height === 'number' ? height : -1;
      }
    } catch { /* measurement failed, non-critical */ }
    return -1;
  }

}

// Export singleton instance
export const powerpointClient = new PowerPointClient();
export type { OfficeResponse, ScreenshotResponse };

