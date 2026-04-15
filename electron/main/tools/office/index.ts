/**
 * Office Automation Module
 *
 * Microsoft Office (Word, Excel, PowerPoint)  
 * PowerShell COM    Office  
 */

export { officeClient } from './office-client';

// Word Tools
export {
  WORD_TOOLS,
  // Basic operations
  wordCreateTool,
  wordOpenTool,
  wordQuitTool,
  wordWriteTool,
  wordReadTool,
  wordSaveTool,
  wordScreenshotTool,
  wordCloseTool,
  // Formatting
  wordSetFontTool,
  wordSetParagraphTool,
  wordSetStyleTool,
  // Content
  wordAddTableTool,
  wordAddImageTool,
  wordAddHyperlinkTool,
  wordFindReplaceTool,
  wordInsertBreakTool,
  // Navigation
  wordSelectAllTool,
  wordGotoTool,
  // Header/Footer
  wordInsertHeaderTool,
  wordInsertFooterTool,
  wordInsertPageNumberTool,
  // Export
  wordExportPDFTool,
  wordPrintTool,
  // Table manipulation
  wordSetTableCellTool,
  wordMergeTableCellsTool,
  wordSetTableStyleTool,
  wordSetTableBorderTool,
  // Bookmarks
  wordAddBookmarkTool,
  wordGetBookmarksTool,
  wordDeleteBookmarkTool,
  wordGotoBookmarkTool,
  // Comments
  wordAddCommentTool,
  wordGetCommentsTool,
  wordDeleteCommentTool,
  wordDeleteAllCommentsTool,
  // Lists
  wordCreateBulletListTool,
  wordCreateNumberedListTool,
  // Page Setup
  wordSetPageMarginsTool,
  wordSetPageOrientationTool,
  wordSetPageSizeTool,
  // Watermark
  wordAddWatermarkTool,
  wordRemoveWatermarkTool,
  // Textbox & Shapes
  wordAddTextboxTool,
  wordAddShapeTool,
  // Document Info
  wordGetDocumentInfoTool,
  // Columns
  wordSetColumnsTool,
  // Undo/Redo
  wordUndoTool,
  wordRedoTool,
  // Selection
  wordGetSelectedTextTool,
} from './word-tools';

// Excel Tools
export {
  EXCEL_TOOLS,
  // Basic operations
  excelCreateTool,
  excelOpenTool,
  excelQuitTool,
  excelWriteCellTool,
  excelReadCellTool,
  excelWriteRangeTool,
  excelReadRangeTool,
  excelSaveTool,
  excelScreenshotTool,
  excelCloseTool,
  // Formulas
  excelSetFormulaTool,
  // Formatting
  excelSetFontTool,
  excelSetFillTool,
  excelSetNumberFormatTool,
  excelSetBorderTool,
  excelSetAlignmentTool,
  excelMergeCellsTool,
  excelUnmergeCellsTool,
  excelSetColumnWidthTool,
  excelSetRowHeightTool,
  // Sheet management
  excelAddSheetTool,
  excelDeleteSheetTool,
  excelRenameSheetTool,
  excelGetSheetsTool,
  excelSelectSheetTool,
  // Data tools
  excelSortRangeTool,
  excelInsertRowTool,
  excelDeleteRowTool,
  excelFreezePanesTool,
  excelAutoFilterTool,
  // Charts
  excelAddChartTool,
  excelSetChartTitleTool,
  excelDeleteChartTool,
  // Conditional Formatting
  excelAddConditionalFormatTool,
  excelClearConditionalFormatTool,
  // Data Validation
  excelSetDataValidationTool,
  excelClearDataValidationTool,
  // Named Ranges
  excelCreateNamedRangeTool,
  excelGetNamedRangesTool,
  excelDeleteNamedRangeTool,
  // Copy/Paste/Clear
  excelCopyRangeTool,
  excelPasteRangeTool,
  excelClearRangeTool,
  // Hide/Show
  excelHideColumnTool,
  excelShowColumnTool,
  excelHideRowTool,
  excelShowRowTool,
  // Images & Hyperlinks
  excelAddImageTool,
  excelAddHyperlinkTool,
  // Export & Print
  excelExportPDFTool,
  excelPrintTool,
  // Comments
  excelAddCommentTool,
  excelGetCommentTool,
  excelDeleteCommentTool,
  // Protection
  excelProtectSheetTool,
  excelUnprotectSheetTool,
  // Find/Replace
  excelFindReplaceTool,
  // Grouping
  excelGroupRowsTool,
  excelUngroupRowsTool,
} from './excel-tools';

// PowerPoint Tools
export {
  POWERPOINT_TOOLS,
  // Basic operations
  powerpointCreateTool,
  powerpointOpenTool,
  powerpointQuitTool,
  powerpointAddSlideTool,
  powerpointDeleteSlideTool,
  powerpointMoveSlideTool,
  powerpointWriteTextTool,
  powerpointReadSlideTool,
  powerpointSaveTool,
  powerpointScreenshotTool,
  powerpointCloseTool,
  // Content
  powerpointAddTextboxTool,
  powerpointAddImageTool,
  powerpointAddShapeTool,
  // Table
  powerpointAddTableTool,
  powerpointSetTableCellTool,
  powerpointSetTableStyleTool,
  // Shape Management
  powerpointDeleteShapeTool,
  powerpointDuplicateShapeTool,
  powerpointRotateShapeTool,
  powerpointGetShapeInfoTool,
  powerpointGetShapeListTool,
  powerpointSetShapeNameTool,
  powerpointSetShapeOpacityTool,
  // Shape Position/Size/Style
  powerpointSetShapePositionTool,
  powerpointSetShapeSizeTool,
  powerpointSetShapeStyleTool,
  // Z-Order
  powerpointBringToFrontTool,
  powerpointSendToBackTool,
  powerpointBringForwardTool,
  powerpointSendBackwardTool,
  // Alignment
  powerpointAlignShapesTool,
  powerpointDistributeShapesTool,
  // Slide Management
  powerpointSetSlideLayoutTool,
  powerpointDuplicateSlideTool,
  powerpointHideSlideTool,
  powerpointShowSlideTool,
  powerpointAddSectionTool,
  powerpointGetSectionsTool,
  // Notes
  powerpointAddNoteTool,
  powerpointGetNoteTool,
  // Grouping
  powerpointGroupShapesTool,
  powerpointUngroupShapesTool,
  // Text Formatting
  powerpointSetTextAlignmentTool,
  powerpointSetBulletListTool,
  powerpointSetLineSpacingTool,
  powerpointSetTextboxBorderTool,
  powerpointSetTextboxFillTool,
  // Media
  powerpointAddHyperlinkTool,
  powerpointAddVideoTool,
  powerpointAddAudioTool,
  powerpointAddChartTool,
  // Effects
  powerpointSetShadowTool,
  powerpointSetReflectionTool,
  powerpointApplyThemeTool,
  // Placeholder
  powerpointSetPlaceholderTextTool,
  powerpointGetPlaceholdersTool,
  powerpointGetSlideLayoutsTool,
  // Formatting
  powerpointSetFontTool,
  powerpointSetBackgroundTool,
  // Animation & Transition
  powerpointAddAnimationTool,
  powerpointSetTransitionTool,
  // Info
  powerpointGetSlideCountTool,
  // Export & Presentation
  powerpointExportPDFTool,
  powerpointStartSlideshowTool,
} from './powerpoint-tools';

// Import for combined array
import { WORD_TOOLS } from './word-tools';
import { EXCEL_TOOLS } from './excel-tools';
import { POWERPOINT_TOOLS } from './powerpoint-tools';

// Combined Office Tools array
export const OFFICE_TOOLS = [...WORD_TOOLS, ...EXCEL_TOOLS, ...POWERPOINT_TOOLS];
