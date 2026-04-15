/**
 * PowerPoint Export Tools
 *
 * Tools for saving, exporting to PDF, and starting slideshow
 */

import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult } from '../../types.js';
import { powerpointClient } from '../powerpoint-client.js';
import { OFFICE_CATEGORIES } from '../common/constants.js';

// =============================================================================
// PowerPoint Save
// =============================================================================

const POWERPOINT_SAVE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powerpoint_save',
    description: `Save the active presentation. WSL paths are automatically converted to Windows paths.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are saving' },
        path: { type: 'string', description: 'File path to save to (optional)' },
      },
      required: ['reason'],
    },
  },
};

async function executePowerPointSave(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Pre-save check: verify closing slide exists
    let closingWarning = '';
    try {
      const infoResp = await powerpointClient.powerpointGetSlideCount();
      if (infoResp.success && infoResp['slide_count']) {
        const slideCount = Number(infoResp['slide_count']);
        if (slideCount > 0) {
          const lastSlideResp = await powerpointClient.powerpointGetShapeList(slideCount);
          const shapeCount = lastSlideResp?.['count'] ?? (Array.isArray(lastSlideResp?.['shapes']) ? lastSlideResp['shapes'].length : 0);
          if (Number(shapeCount) < 2) {
            closingWarning = ` ⚠ WARNING: Your LAST slide (slide ${slideCount}) has only ${shapeCount} shape(s) — it does NOT look like a proper closing slide. You MUST add a closing slide with ""/"Thank You" text and a colored background BEFORE finishing. Do NOT call "complete" yet — build the closing slide first!`;
          }
        }
      }
    } catch { /* non-critical check, proceed with save */ }

    const response = await powerpointClient.powerpointSave(args['path'] as string | undefined);
    if (response.success) {
      return { success: true, result: `Presentation saved: ${response['path'] || 'current location'}${closingWarning}` };
    }
    return { success: false, error: response.error || 'Failed to save presentation' };
  } catch (error) {
    return { success: false, error: `Failed to save presentation: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const powerpointSaveTool: LLMSimpleTool = {
  definition: POWERPOINT_SAVE_DEFINITION,
  execute: executePowerPointSave,
  categories: OFFICE_CATEGORIES,
  description: 'Save PowerPoint presentation',
};

// =============================================================================
// PowerPoint Export to PDF
// =============================================================================

const POWERPOINT_EXPORT_PDF_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powerpoint_export_pdf',
    description: `Export the presentation to PDF. WSL paths are automatically converted to Windows paths.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are exporting to PDF' },
        path: { type: 'string', description: 'Output PDF file path' },
      },
      required: ['reason', 'path'],
    },
  },
};

async function executePowerPointExportPDF(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await powerpointClient.powerpointExportToPDF(args['path'] as string);
    if (response.success) {
      return { success: true, result: `Exported to PDF: ${response['path'] || args['path']}` };
    }
    return { success: false, error: response.error || 'Failed to export to PDF' };
  } catch (error) {
    return { success: false, error: `Failed to export to PDF: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const powerpointExportPDFTool: LLMSimpleTool = {
  definition: POWERPOINT_EXPORT_PDF_DEFINITION,
  execute: executePowerPointExportPDF,
  categories: OFFICE_CATEGORIES,
  description: 'Export PowerPoint to PDF',
};

// =============================================================================
// PowerPoint Start Slideshow
// =============================================================================

const POWERPOINT_START_SLIDESHOW_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powerpoint_start_slideshow',
    description: `Start the slideshow presentation.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are starting slideshow' },
        from_slide: { type: 'number', description: 'Starting slide number (default: 1)' },
      },
      required: ['reason'],
    },
  },
};

async function executePowerPointStartSlideshow(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const fromSlide = args['from_slide'] != null ? Number(args['from_slide']) : 1;
    const response = await powerpointClient.powerpointStartSlideshow(fromSlide);
    if (response.success) {
      return { success: true, result: `Slideshow started from slide ${fromSlide}` };
    }
    return { success: false, error: response.error || 'Failed to start slideshow' };
  } catch (error) {
    return { success: false, error: `Failed to start slideshow: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const powerpointStartSlideshowTool: LLMSimpleTool = {
  definition: POWERPOINT_START_SLIDESHOW_DEFINITION,
  execute: executePowerPointStartSlideshow,
  categories: OFFICE_CATEGORIES,
  description: 'Start PowerPoint slideshow',
};

// =============================================================================
// PowerPoint Export Slide as Image
// =============================================================================

const POWERPOINT_EXPORT_SLIDE_AS_IMAGE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powerpoint_export_slide_as_image',
    description: `Export a specific slide as PNG or JPG image. Useful for creating thumbnails or sharing individual slides. WSL paths are auto-converted.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are exporting slide as image' },
        slide_number: { type: 'number', description: 'Slide number to export' },
        path: { type: 'string', description: 'Output image file path (include .png or .jpg extension)' },
        format: { type: 'string', enum: ['png', 'jpg'], description: 'Image format (default: png)' },
        width: { type: 'number', description: 'Image width in pixels (optional, maintains aspect ratio if only width provided)' },
        height: { type: 'number', description: 'Image height in pixels (optional)' },
      },
      required: ['reason', 'slide_number', 'path'],
    },
  },
};

async function executePowerPointExportSlideAsImage(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slideNum = Number(args['slide_number']);
    const path = args['path'] as string;
    const format = (args['format'] as 'png' | 'jpg') || 'png';
    const width = args['width'] != null ? Number(args['width']) : undefined;
    const height = args['height'] != null ? Number(args['height']) : undefined;

    const response = await powerpointClient.powerpointExportSlideAsImage(slideNum, path, format, width, height);
    if (response.success) {
      return { success: true, result: `Slide ${slideNum} exported as ${format}: ${response['path'] || path}` };
    }
    return { success: false, error: response.error || 'Failed to export slide as image' };
  } catch (error) {
    return { success: false, error: `Failed to export slide as image: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const powerpointExportSlideAsImageTool: LLMSimpleTool = {
  definition: POWERPOINT_EXPORT_SLIDE_AS_IMAGE_DEFINITION,
  execute: executePowerPointExportSlideAsImage,
  categories: OFFICE_CATEGORIES,
  description: 'Export slide as PNG/JPG image',
};

// =============================================================================
// Export
// =============================================================================

export const exportTools: LLMSimpleTool[] = [
  powerpointSaveTool,
  powerpointExportPDFTool,
  powerpointStartSlideshowTool,
  powerpointExportSlideAsImageTool,
];
