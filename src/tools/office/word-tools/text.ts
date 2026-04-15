/**
 * Microsoft Word Text Tools
 *
 * Text-related tools for Word document manipulation:
 * - writeText: Write text to the document
 * - readDocument: Read document content
 * - findReplace: Find and replace text
 * - setStyle: Apply style to selection
 * - getSelectedText: Get selected text
 * - selectAll: Select all content
 */

import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult } from '../../types.js';
import { wordClient } from '../word-client.js';
import { OFFICE_CATEGORIES } from '../common/constants.js';

// =============================================================================
// Word Write
// =============================================================================

const WORD_WRITE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_write',
    description: `Write text to the active Word document with full formatting in one call.
Supports font (name, size, bold, italic, color) and paragraph (alignment, spacing) settings.
By default, a new paragraph is created after the text (new_paragraph=true).
IMPORTANT: Always specify font_name, font_size, and color for proper formatting.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Explanation of why you are writing this text' },
        text: { type: 'string', description: 'The text to write to the document' },
        font_name: { type: 'string', description: 'Font name (e.g., " ", "Arial")' },
        font_size: { type: 'number', description: 'Font size in points' },
        bold: { type: 'boolean', description: 'Bold text' },
        italic: { type: 'boolean', description: 'Italic text' },
        color: { type: 'string', description: 'Font color as hex (e.g., "#1B3A5C", "#333333")' },
        alignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Paragraph alignment' },
        space_before: { type: 'number', description: 'Space before paragraph in points' },
        space_after: { type: 'number', description: 'Space after paragraph in points' },
        line_spacing: { type: 'number', description: 'Line spacing multiplier (e.g., 1.0, 1.3, 1.5)' },
        new_paragraph: { type: 'boolean', description: 'Add paragraph break after text (default: true)' },
      },
      required: ['reason', 'text'],
    },
  },
};

async function executeWordWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const text = args['text'] as string;
  const fontName = args['font_name'] as string | undefined;
  const fontSize = args['font_size'] as number | undefined;
  const bold = args['bold'] as boolean | undefined;
  const italic = args['italic'] as boolean | undefined;
  const newParagraph = args['new_paragraph'] as boolean | undefined;
  const color = args['color'] as string | undefined;
  const alignment = args['alignment'] as 'left' | 'center' | 'right' | 'justify' | undefined;
  const spaceBefore = args['space_before'] != null ? Number(args['space_before']) : undefined;
  const spaceAfter = args['space_after'] != null ? Number(args['space_after']) : undefined;
  const lineSpacing = args['line_spacing'] != null ? Number(args['line_spacing']) : undefined;

  try {
    const response = await wordClient.wordWrite(text, {
      fontName, fontSize, bold, italic, newParagraph,
      color, alignment, spaceBefore, spaceAfter, lineSpacing,
    });
    if (response.success) {
      return { success: true, result: `Text written to document (${text.length} characters)` };
    }
    return { success: false, error: response.error || 'Failed to write text' };
  } catch (error) {
    return { success: false, error: `Failed to write text: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordWriteTool: LLMSimpleTool = {
  definition: WORD_WRITE_DEFINITION,
  execute: executeWordWrite,
  categories: OFFICE_CATEGORIES,
  description: 'Write text to Word document',
};

// =============================================================================
// Word Read
// =============================================================================

const WORD_READ_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_read',
    description: `Read the content of the active Word document.
Returns the full text content of the document.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Explanation of why you are reading the document' },
      },
      required: ['reason'],
    },
  },
};

async function executeWordRead(_args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await wordClient.wordRead();
    if (response.success) {
      const content = response['content'] as string || '';
      const docName = response['document_name'] as string || 'Unknown';
      return {
        success: true,
        result: `Document: ${docName}\n\nContent:\n${content || '(empty document)'}`,
      };
    }
    return { success: false, error: response.error || 'Failed to read document' };
  } catch (error) {
    return { success: false, error: `Failed to read document: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordReadTool: LLMSimpleTool = {
  definition: WORD_READ_DEFINITION,
  execute: executeWordRead,
  categories: OFFICE_CATEGORIES,
  description: 'Read Word document content',
};

// =============================================================================
// Word Find Replace
// =============================================================================

const WORD_FIND_REPLACE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_find_replace',
    description: `Find and replace text in the Word document.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are doing find/replace' },
        find: { type: 'string', description: 'Text to find' },
        replace: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences (default: true)' },
      },
      required: ['reason', 'find', 'replace'],
    },
  },
};

async function executeWordFindReplace(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await wordClient.wordFindReplace(
      args['find'] as string,
      args['replace'] as string,
      args['replace_all'] as boolean ?? true
    );
    if (response.success) {
      return { success: true, result: `Replaced "${args['find']}" with "${args['replace']}"` };
    }
    return { success: false, error: response.error || 'Failed to find/replace' };
  } catch (error) {
    return { success: false, error: `Failed to find/replace: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordFindReplaceTool: LLMSimpleTool = {
  definition: WORD_FIND_REPLACE_DEFINITION,
  execute: executeWordFindReplace,
  categories: OFFICE_CATEGORIES,
  description: 'Find and replace in Word',
};

// =============================================================================
// Word Set Style
// =============================================================================

const WORD_SET_STYLE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_set_style',
    description: `Apply a style to the current selection. IMPORTANT: Style names depend on Office language. English: "Normal", "Heading 1", "Title". Korean: "", " 1", "".`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are applying a style' },
        style: { type: 'string', description: 'Style name' },
      },
      required: ['reason', 'style'],
    },
  },
};

async function executeWordSetStyle(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await wordClient.wordSetStyle(args['style'] as string);
    if (response.success) {
      return { success: true, result: `Style "${args['style']}" applied` };
    }
    return { success: false, error: response.error || 'Failed to set style' };
  } catch (error) {
    return { success: false, error: `Failed to set style: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordSetStyleTool: LLMSimpleTool = {
  definition: WORD_SET_STYLE_DEFINITION,
  execute: executeWordSetStyle,
  categories: OFFICE_CATEGORIES,
  description: 'Apply Word style',
};

// =============================================================================
// Word Get Selected Text
// =============================================================================

const WORD_GET_SELECTED_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_get_selected_text',
    description: `Get the currently selected text.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you need selected text' },
      },
      required: ['reason'],
    },
  },
};

async function executeWordGetSelectedText(_args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await wordClient.wordGetSelectedText();
    if (response.success) {
      const text = response['text'] as string || '';
      if (!text || text.length === 0) {
        return { success: true, result: 'No text selected' };
      }
      return { success: true, result: `Selected text: "${text}"` };
    }
    return { success: false, error: response.error || 'Failed to get selected text' };
  } catch (error) {
    return { success: false, error: `Failed to get selected text: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordGetSelectedTextTool: LLMSimpleTool = {
  definition: WORD_GET_SELECTED_TEXT_DEFINITION,
  execute: executeWordGetSelectedText,
  categories: OFFICE_CATEGORIES,
  description: 'Get Word selected text',
};

// =============================================================================
// Word Select All
// =============================================================================

const WORD_SELECT_ALL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_select_all',
    description: `Select all content in the document.`,
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you are selecting all' },
      },
      required: ['reason'],
    },
  },
};

async function executeWordSelectAll(_args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const response = await wordClient.wordSelectAll();
    if (response.success) {
      return { success: true, result: 'All content selected' };
    }
    return { success: false, error: response.error || 'Failed to select all' };
  } catch (error) {
    return { success: false, error: `Failed to select all: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const wordSelectAllTool: LLMSimpleTool = {
  definition: WORD_SELECT_ALL_DEFINITION,
  execute: executeWordSelectAll,
  categories: OFFICE_CATEGORIES,
  description: 'Select all in Word',
};

// =============================================================================
// Export All Text Tools
// =============================================================================

export const textTools: LLMSimpleTool[] = [
  wordWriteTool,
  wordReadTool,
  wordFindReplaceTool,
  wordSetStyleTool,
  wordGetSelectedTextTool,
  wordSelectAllTool,
];
