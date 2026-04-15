/**
 * Word Section Builder Tools
 *
 * High-level tools that create complete document sections in 1 tool call.
 * Each builder handles styles, fonts, colors, and spacing internally.
 * Used by the Word Creation Agent for new documents.
 *
 * Electron parity: src/tools/office/word-tools/section-builders.ts
 */

import { ToolDefinition } from '../../../types/index';
import { LLMSimpleTool, ToolResult } from '../../types';
import { wordClient } from '../word-client';
import { OFFICE_CATEGORIES } from '../common/constants';

// =============================================================================
// Types & Presets
// =============================================================================

interface ColorConfig {
  primary: string;   // Headings, emphasis
  accent: string;    // Table headers, decorative
  body: string;      // Body text color
  light: string;     // Light backgrounds
}

interface FontConfig {
  title: string;
  body: string;
}

const COLOR_PRESETS: Record<string, ColorConfig> = {
  MODERN_TECH: { primary: '#0D1B2A', accent: '#1B998B', body: '#333333', light: '#E0F7F5' },
  WARM_EXECUTIVE: { primary: '#2C1810', accent: '#C45B28', body: '#333333', light: '#FFF3EC' },
  CLEAN_MINIMAL: { primary: '#1A1A2E', accent: '#16213E', body: '#444444', light: '#F5F5F5' },
  CORPORATE: { primary: '#1B3A5C', accent: '#2E5090', body: '#333333', light: '#EBF0F7' },
  NATURE_FRESH: { primary: '#1B4332', accent: '#2D6A4F', body: '#333333', light: '#D8F3DC' },
  BOLD_MODERN: { primary: '#1A1A2E', accent: '#E63946', body: '#333333', light: '#F8F9FA' },
};

const FONT_PRESETS: Record<string, FontConfig> = {
  MODERN_TECH: { title: 'Segoe UI', body: ' ' },
  WARM_EXECUTIVE: { title: 'Georgia', body: ' ' },
  CLEAN_MINIMAL: { title: ' ', body: '' },
  CORPORATE: { title: 'Calibri', body: ' ' },
  NATURE_FRESH: { title: '', body: ' ' },
  BOLD_MODERN: { title: 'Arial Black', body: ' ' },
};

const DEFAULT_FONTS: FontConfig = { title: 'Segoe UI', body: ' ' };

/**
 * Strip common markdown formatting from text before writing to Word.
 * Removes **bold**, __bold__, *italic*, _italic_, ~~strikethrough~~, `code`.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    // Strip HTML tags: <br>, <b>text</b>, <div>...</div>, self-closing <hr/>, etc.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function generateLightTint(hexColor: string): string {
  // Generate a very light tint (8% opacity) from a hex color
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lr = Math.round(r * 0.08 + 255 * 0.92);
  const lg = Math.round(g * 0.08 + 255 * 0.92);
  const lb = Math.round(b * 0.08 + 255 * 0.92);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

function resolveColors(args: Record<string, unknown>): ColorConfig {
  if (args['colors'] && typeof args['colors'] === 'object') {
    const c = args['colors'] as Record<string, string>;
    const accent = c['accent'] || '#1B998B';
    let light = c['light'] || '#F5F5F5';
    // If light is pure white or near-white, generate a tint from accent for visible heading backgrounds
    if (light === '#FFFFFF' || light === '#ffffff' || light === '#FFF' || light === '#fff') {
      light = generateLightTint(accent);
    }
    return {
      primary: c['primary'] || '#1A1A2E',
      accent,
      body: c['body'] || '#333333',
      light,
    };
  }
  const scheme = (args['color_scheme'] as string) || 'MODERN_TECH';
  return COLOR_PRESETS[scheme] ?? COLOR_PRESETS['MODERN_TECH']!;
}

function resolveFonts(args: Record<string, unknown>): FontConfig {
  if (args['fonts'] && typeof args['fonts'] === 'object') {
    const f = args['fonts'] as Record<string, string>;
    return { title: f['title'] || 'Segoe UI', body: f['body'] || ' ' };
  }
  if (typeof args['fonts'] === 'string') {
    return FONT_PRESETS[args['fonts']] ?? DEFAULT_FONTS;
  }
  const scheme = (args['color_scheme'] as string) || 'MODERN_TECH';
  return FONT_PRESETS[scheme] ?? DEFAULT_FONTS;
}

// Common color/font parameter definitions for tool schemas
const COLOR_FONT_PARAMS = {
  color_scheme: { type: 'string' as const, description: 'Preset: MODERN_TECH, WARM_EXECUTIVE, CLEAN_MINIMAL, CORPORATE, NATURE_FRESH, BOLD_MODERN' },
  colors: { type: 'object' as const, properties: { primary: { type: 'string' as const }, accent: { type: 'string' as const }, body: { type: 'string' as const }, light: { type: 'string' as const } } },
  fonts: { type: 'object' as const, properties: { title: { type: 'string' as const }, body: { type: 'string' as const } } },
};

// =============================================================================
// Tool 1: Title Page
// =============================================================================

const WORD_BUILD_TITLE_PAGE_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_title_page',
    description: 'Build a complete title page with centered title, subtitle, date/author, and a page break. One call = one finished title page.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        subtitle: { type: 'string', description: 'Subtitle or description' },
        date_text: { type: 'string', description: 'Date string (e.g., "2024 12monthly")' },
        author: { type: 'string', description: 'Author name' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['title'],
    },
  },
};

async function executeBuildTitlePage(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const title = (args['title'] as string) || 'Document';
    const subtitle = (args['subtitle'] as string) || '';
    const dateText = (args['date_text'] as string) || '';
    const author = (args['author'] as string) || '';

    // Text-based title page (no floating shapes — stable across all page layouts)
    for (let i = 0; i < 6; i++) {
      await wordClient.wordWrite(' ', { fontSize: 20, newParagraph: true, spaceAfter: 0, spaceBefore: 0 });
    }
    // Accent divider line
    await wordClient.wordWrite('                                                                                              ', {
      fontSize: 2, newParagraph: true, spaceAfter: 16, spaceBefore: 0,
      bgColor: colors.accent,
    });
    const titleFontSize = title.length <= 10 ? 42 : title.length <= 16 ? 36 : title.length <= 22 ? 30 : 26;
    await wordClient.wordWrite(title, {
      fontName: fonts.title, fontSize: titleFontSize, bold: true, color: colors.primary,
      alignment: 'center', newParagraph: true, spaceAfter: 12, spaceBefore: 12,
    });
    if (subtitle) {
      await wordClient.wordWrite(subtitle, {
        fontName: fonts.body, fontSize: 16, color: '#444444',
        alignment: 'center', newParagraph: true, spaceAfter: 10,
      });
    }
    // Accent divider line
    await wordClient.wordWrite('                                                                                              ', {
      fontSize: 2, newParagraph: true, spaceAfter: 16, spaceBefore: 16,
      bgColor: colors.accent,
    });
    if (dateText || author) {
      await wordClient.wordWrite([dateText, author].filter(Boolean).join('  |  '), {
        fontName: fonts.body, fontSize: 11, color: '#777777',
        alignment: 'center', newParagraph: true, spaceAfter: 0,
      });
    }

    // Page break after title page
    await wordClient.wordInsertBreak('page');

    return { success: true, result: 'Title page built successfully' };
  } catch (error) {
    return { success: false, error: `Failed to build title page: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 2: Table of Contents
// =============================================================================

const WORD_BUILD_TOC_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_toc',
    description: 'Insert a table of contents followed by a page break. Call this after the title page and before content sections.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'TOC title text (default: "")' },
        toc_depth: { type: 'number', description: 'Heading depth to include (1=H1 only, 2=H1+H2, 3=H1+H2+H3). Default: 2. Use 1 for documents with many sections.' },
        ...COLOR_FONT_PARAMS,
      },
      required: [],
    },
  },
};

async function executeBuildTOC(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const tocTitle = (args['title'] as string) || '';

    // TOC heading with accent left border
    await wordClient.wordWrite(tocTitle, {
      fontName: fonts.title, fontSize: 20, bold: true, color: colors.primary,
      alignment: 'left', newParagraph: true, spaceAfter: 12,
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // Insert automatic TOC — depth controlled by LLM parameter (default: H1+H2)
    const tocDepth = (args['toc_depth'] as number) || 2;
    await wordClient.wordInsertTOC({ lowerHeadingLevel: tocDepth });

    // Page break
    await wordClient.wordInsertBreak('page');

    return { success: true, result: 'Table of contents built successfully' };
  } catch (error) {
    return { success: false, error: `Failed to build TOC: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 3: Section (Heading + Body)
// =============================================================================

const WORD_BUILD_SECTION_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_section',
    description: 'Build a complete document section with a heading and body paragraphs. Supports sub-sections with Heading 2. One call = one finished section.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Section heading text (will be Heading 1 style)' },
        body_paragraphs: {
          type: 'array', items: { type: 'string' },
          description: 'Array of body paragraphs. Each string becomes a separate paragraph.',
        },
        sub_sections: {
          type: 'array',
          description: 'Optional sub-sections, each with heading (Heading 2) and body paragraphs',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              body_paragraphs: { type: 'array', items: { type: 'string' } },
            },
            required: ['heading', 'body_paragraphs'],
          },
        },
        ...COLOR_FONT_PARAMS,
      },
      required: ['heading', 'body_paragraphs'],
    },
  },
};

async function executeBuildSection(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const heading = stripMarkdown((args['heading'] as string) || '');
    const bodyParagraphs = (args['body_paragraphs'] as string[]) || [];
    const subSections = (args['sub_sections'] as Array<Record<string, unknown>>) || [];

    // Main heading (Heading 1) — with accent left border and light background
    await wordClient.wordWrite(heading, {
      fontName: fonts.title, fontSize: 18, bold: true, color: colors.primary,
      newParagraph: true, spaceAfter: 8, spaceBefore: 16, styleName: 'Heading 1',
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // Body paragraphs
    for (const para of bodyParagraphs) {
      await wordClient.wordWrite(stripMarkdown(para), {
        fontName: fonts.body, fontSize: 11, color: colors.body,
        alignment: 'justify', newParagraph: true, spaceAfter: 6, lineSpacing: 1.5,
      });
    }

    // Sub-sections
    for (const sub of subSections) {
      const subHeading = stripMarkdown((sub['heading'] as string) || '');
      const subBody = (sub['body_paragraphs'] as string[]) || [];

      await wordClient.wordWrite(subHeading, {
        fontName: fonts.title, fontSize: 14, bold: true, color: colors.accent,
        newParagraph: true, spaceAfter: 6, spaceBefore: 12, styleName: 'Heading 2',
        leftBorderColor: colors.accent, leftBorderWidth: 3,
        keepWithNext: true,
      });

      for (const para of subBody) {
        await wordClient.wordWrite(stripMarkdown(para), {
          fontName: fonts.body, fontSize: 11, color: colors.body,
          alignment: 'justify', newParagraph: true, spaceAfter: 6, lineSpacing: 1.5,
        });
      }
    }

    return { success: true, result: `Section "${heading}" built successfully` };
  } catch (error) {
    return { success: false, error: `Failed to build section: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 4: Table Section
// =============================================================================

const WORD_BUILD_TABLE_SECTION_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_table_section',
    description: 'Build a section with a heading and a styled table. Row 0 of table_data is treated as headers. One call = heading + styled table.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Section heading text' },
        table_data: {
          type: 'array',
          description: '2D array: first row = headers, rest = data rows',
          items: { type: 'array', items: { type: 'string' } },
        },
        caption: { type: 'string', description: 'Optional caption below the table' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['heading', 'table_data'],
    },
  },
};

async function executeBuildTableSection(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const heading = stripMarkdown((args['heading'] as string) || '');
    const tableData = (args['table_data'] as string[][]) || [];
    const caption = (args['caption'] as string) || '';

    if (tableData.length < 2) {
      return { success: false, error: 'Table requires at least 2 rows (1 header + 1 data)' };
    }

    // Filter out rows where ALL cells are empty/whitespace (keep header row always)
    const filteredData = [tableData[0]!]; // Always keep header
    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i]!;
      if (row.some(cell => cell && cell.trim() !== '')) {
        filteredData.push(row);
      }
    }
    // If no data rows survived, return error
    if (filteredData.length < 2) {
      return { success: false, error: 'Table has no non-empty data rows' };
    }

    // Heading — with accent left border and light background
    await wordClient.wordWrite(heading, {
      fontName: fonts.title, fontSize: 18, bold: true, color: colors.primary,
      newParagraph: true, spaceAfter: 8, spaceBefore: 16, styleName: 'Heading 1',
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // Add table — strip markdown from each cell (use filteredData to exclude empty rows)
    const cleanTableData = filteredData.map(row => row.map(stripMarkdown));
    const rows = cleanTableData.length;
    const cols = cleanTableData[0]!.length;
    await wordClient.wordAddTable(rows, cols, cleanTableData);

    // Style header row with accent color background + white text + alternating rows
    try {
      await wordClient.wordStyleTableHeaderRow(1, colors.accent);
    } catch {
      // Fallback: try basic grid style
      try { await wordClient.wordSetTableStyle(1, 'Table Grid'); } catch { /* ignore */ }
    }

    // Caption
    if (caption) {
      await wordClient.wordWrite(caption, {
        fontName: fonts.body, fontSize: 9, italic: true, color: '#888888',
        alignment: 'center', newParagraph: true, spaceAfter: 8,
      });
    }

    return { success: true, result: `Table section "${heading}" built (${rows}×${cols})` };
  } catch (error) {
    return { success: false, error: `Failed to build table section: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 5: List Section
// =============================================================================

const WORD_BUILD_LIST_SECTION_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_list_section',
    description: 'Build a section with a heading and a bullet or numbered list. One call = heading + styled list.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Section heading text' },
        items: {
          type: 'array', items: { type: 'string' },
          description: 'List items',
        },
        list_type: { type: 'string', enum: ['bullet', 'numbered'], description: 'List type (default: bullet)' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['heading', 'items'],
    },
  },
};

async function executeBuildListSection(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const heading = stripMarkdown((args['heading'] as string) || '');
    const items = (args['items'] as string[]) || [];
    const listType = (args['list_type'] as string) || 'bullet';

    // Heading — with accent left border and light background
    await wordClient.wordWrite(heading, {
      fontName: fonts.title, fontSize: 18, bold: true, color: colors.primary,
      newParagraph: true, spaceAfter: 8, spaceBefore: 16, styleName: 'Heading 1',
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // List — strip markdown from each item
    const cleanItems = items.map(stripMarkdown);
    if (listType === 'numbered') {
      await wordClient.wordCreateNumberedList(cleanItems);
    } else {
      await wordClient.wordCreateBulletList(cleanItems);
    }

    return { success: true, result: `List section "${heading}" built (${items.length} items)` };
  } catch (error) {
    return { success: false, error: `Failed to build list section: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 6: Callout Box (Key Insight / Tip / Warning)
// =============================================================================

const WORD_BUILD_CALLOUT_BOX_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_callout_box',
    description: 'Build a visually distinct callout box for key insights, tips, warnings, or summaries. Uses colored background + left border accent for visual emphasis. Great for breaking up monotonous text sections.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Callout title (e.g., " ", "Key Takeaway", "⚡ ")' },
        body: { type: 'string', description: 'Callout body text — the key insight or information' },
        style: { type: 'string', enum: ['insight', 'tip', 'warning', 'summary'], description: 'Visual style: insight (accent), tip (green), warning (orange/red), summary (primary)' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['title', 'body'],
    },
  },
};

async function executeBuildCalloutBox(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const title = (args['title'] as string) || 'Key Insight';
    const body = (args['body'] as string) || '';
    const style = (args['style'] as string) || 'insight';

    // Choose border color and bg based on style
    let borderColor = colors.accent;
    let bgColor = colors.light;
    if (style === 'warning') {
      borderColor = '#E17055';
      bgColor = '#FFF5F2';
    } else if (style === 'tip') {
      borderColor = '#00B894';
      bgColor = '#F0FFF4';
    } else if (style === 'summary') {
      borderColor = colors.primary;
      bgColor = colors.light;
    }

    // Callout title with colored left border + background
    await wordClient.wordWrite(stripMarkdown(title), {
      fontName: fonts.title, fontSize: 12, bold: true, color: borderColor,
      newParagraph: true, spaceAfter: 2, spaceBefore: 12,
      bgColor, leftBorderColor: borderColor, leftBorderWidth: 5,
      keepWithNext: true,
    });

    // Callout body with same background + border
    await wordClient.wordWrite(stripMarkdown(body), {
      fontName: fonts.body, fontSize: 11, color: colors.body,
      newParagraph: true, spaceAfter: 12, lineSpacing: 1.4,
      bgColor, leftBorderColor: borderColor, leftBorderWidth: 5,
    });

    return { success: true, result: `Callout box "${title}" built` };
  } catch (error) {
    return { success: false, error: `Failed to build callout box: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 7: Key Metrics Display
// =============================================================================

const WORD_BUILD_KEY_METRICS_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_key_metrics',
    description: 'Display 3-6 key statistics/metrics prominently with large accent-colored numbers and labels. Perfect for executive summaries, dashboards, and highlighting key data points.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Section heading (e.g., "  ", "Key Metrics")' },
        metrics: {
          type: 'array',
          description: 'Array of metrics: each has value (large number) and label (description)',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'The metric value (e.g., "32%", "$4.2M", "847")' },
              label: { type: 'string', description: 'What the metric represents (e.g., " ", "Annual Savings")' },
            },
            required: ['value', 'label'],
          },
        },
        ...COLOR_FONT_PARAMS,
      },
      required: ['heading', 'metrics'],
    },
  },
};

async function executeBuildKeyMetrics(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const heading = stripMarkdown((args['heading'] as string) || 'Key Metrics');
    const metrics = (args['metrics'] as Array<Record<string, string>>) || [];

    // Heading
    await wordClient.wordWrite(heading, {
      fontName: fonts.title, fontSize: 18, bold: true, color: colors.primary,
      newParagraph: true, spaceAfter: 8, spaceBefore: 16, styleName: 'Heading 1',
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // Metrics as colored blocks — each metric as value + label pair
    for (const metric of metrics) {
      const value = metric['value'] || '';
      const label = metric['label'] || '';

      // Large value in accent color with light background
      await wordClient.wordWrite(value, {
        fontName: fonts.title, fontSize: 28, bold: true, color: colors.accent,
        alignment: 'center', newParagraph: true, spaceAfter: 0, spaceBefore: 8,
        bgColor: colors.light,
      });

      // Label below in smaller muted text
      await wordClient.wordWrite(label, {
        fontName: fonts.body, fontSize: 11, color: '#666666',
        alignment: 'center', newParagraph: true, spaceAfter: 8, spaceBefore: 0,
        bgColor: colors.light,
      });
    }

    // Thin accent divider after metrics
    await wordClient.wordWrite('                                                                                    ', {
      fontSize: 2, newParagraph: true, spaceAfter: 8, spaceBefore: 4,
      bgColor: colors.accent,
    });

    return { success: true, result: `Key metrics section "${heading}" built (${metrics.length} metrics)` };
  } catch (error) {
    return { success: false, error: `Failed to build key metrics: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 8: Conclusion
// =============================================================================

const WORD_BUILD_CONCLUSION_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_conclusion',
    description: 'Build a conclusion section with heading and body text. Typically the last content section.',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Conclusion heading (e.g., "", "")' },
        body: { type: 'string', description: 'Conclusion body text' },
        ...COLOR_FONT_PARAMS,
      },
      required: ['heading', 'body'],
    },
  },
};

async function executeBuildConclusion(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const heading = stripMarkdown((args['heading'] as string) || '');
    const body = (args['body'] as string) || '';

    // Heading — with accent left border and light background
    await wordClient.wordWrite(heading, {
      fontName: fonts.title, fontSize: 18, bold: true, color: colors.primary,
      newParagraph: true, spaceAfter: 8, spaceBefore: 16, styleName: 'Heading 1',
      bgColor: colors.light, leftBorderColor: colors.accent, leftBorderWidth: 4,
      keepWithNext: true,
    });

    // Body
    await wordClient.wordWrite(stripMarkdown(body), {
      fontName: fonts.body, fontSize: 11, color: colors.body,
      alignment: 'justify', newParagraph: true, spaceAfter: 6, lineSpacing: 1.5,
    });

    return { success: true, result: `Conclusion "${heading}" built successfully` };
  } catch (error) {
    return { success: false, error: `Failed to build conclusion: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 7: Page Break
// =============================================================================

const WORD_BUILD_PAGE_BREAK_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'word_build_page_break',
    description: 'Insert a page break at the current cursor position.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

async function executeBuildPageBreak(): Promise<ToolResult> {
  try {
    await wordClient.wordInsertBreak('page');
    return { success: true, result: 'Page break inserted' };
  } catch (error) {
    return { success: false, error: `Failed to insert page break: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Export all section builder tools
// =============================================================================

export const wordBuildTitlePageTool: LLMSimpleTool = {
  definition: WORD_BUILD_TITLE_PAGE_DEF,
  execute: executeBuildTitlePage,
  categories: OFFICE_CATEGORIES,
  description: 'Build complete title page',
};

export const wordBuildTOCTool: LLMSimpleTool = {
  definition: WORD_BUILD_TOC_DEF,
  execute: executeBuildTOC,
  categories: OFFICE_CATEGORIES,
  description: 'Build table of contents',
};

export const wordBuildSectionTool: LLMSimpleTool = {
  definition: WORD_BUILD_SECTION_DEF,
  execute: executeBuildSection,
  categories: OFFICE_CATEGORIES,
  description: 'Build document section',
};

export const wordBuildTableSectionTool: LLMSimpleTool = {
  definition: WORD_BUILD_TABLE_SECTION_DEF,
  execute: executeBuildTableSection,
  categories: OFFICE_CATEGORIES,
  description: 'Build table section',
};

export const wordBuildListSectionTool: LLMSimpleTool = {
  definition: WORD_BUILD_LIST_SECTION_DEF,
  execute: executeBuildListSection,
  categories: OFFICE_CATEGORIES,
  description: 'Build list section',
};

export const wordBuildCalloutBoxTool: LLMSimpleTool = {
  definition: WORD_BUILD_CALLOUT_BOX_DEF,
  execute: executeBuildCalloutBox,
  categories: OFFICE_CATEGORIES,
  description: 'Build callout box',
};

export const wordBuildKeyMetricsTool: LLMSimpleTool = {
  definition: WORD_BUILD_KEY_METRICS_DEF,
  execute: executeBuildKeyMetrics,
  categories: OFFICE_CATEGORIES,
  description: 'Build key metrics display',
};

export const wordBuildConclusionTool: LLMSimpleTool = {
  definition: WORD_BUILD_CONCLUSION_DEF,
  execute: executeBuildConclusion,
  categories: OFFICE_CATEGORIES,
  description: 'Build conclusion section',
};

export const wordBuildPageBreakTool: LLMSimpleTool = {
  definition: WORD_BUILD_PAGE_BREAK_DEF,
  execute: executeBuildPageBreak,
  categories: OFFICE_CATEGORIES,
  description: 'Insert page break',
};

export const sectionBuilderTools: LLMSimpleTool[] = [
  wordBuildTitlePageTool,
  wordBuildTOCTool,
  wordBuildSectionTool,
  wordBuildTableSectionTool,
  wordBuildListSectionTool,
  wordBuildCalloutBoxTool,
  wordBuildKeyMetricsTool,
  wordBuildConclusionTool,
  wordBuildPageBreakTool,
];
