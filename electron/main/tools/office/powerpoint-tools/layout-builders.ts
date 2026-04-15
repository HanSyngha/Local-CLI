/**
 * PowerPoint Layout Builder Tools
 *
 * High-level tools that create complete slides in 1 tool call.
 * Each builder handles coordinates, colors, fonts, and overflow prevention internally.
 * Used by the PowerPoint Creation Agent for new presentations.
 *
 * Electron parity: src/tools/office/powerpoint-tools/layout-builders.ts
 */

import { ToolDefinition } from '../../../types/index';
import { LLMSimpleTool, ToolResult } from '../../types';
import { powerpointClient } from '../powerpoint-client';
import { OFFICE_CATEGORIES } from '../common/constants';

// =============================================================================
// Types & Presets
// =============================================================================

type DesignStyleName = 'sidebar' | 'top_band' | 'clean';

interface ColorConfig {
  primary: string;
  accent: string;
  light: string;
  highlight: string;
  sidebar: string;
}

interface FontConfig {
  title: string;
  body: string;
}

const COLOR_PRESETS: Record<string, ColorConfig> = {
  MODERN_TECH: { primary: '#0D1B2A', accent: '#1B998B', light: '#E0F7F5', highlight: '#3CDFFF', sidebar: '#14514A' },
  WARM_EXECUTIVE: { primary: '#2C1810', accent: '#C45B28', light: '#FFF3EC', highlight: '#E8A87C', sidebar: '#8B4513' },
  CLEAN_MINIMAL: { primary: '#1A1A2E', accent: '#16213E', light: '#F5F5F5', highlight: '#0F3460', sidebar: '#2C3E6B' },
  CORPORATE: { primary: '#1B3A5C', accent: '#2E5090', light: '#EBF0F7', highlight: '#B0C4DE', sidebar: '#1B3A5C' },
  NATURE_FRESH: { primary: '#1B4332', accent: '#2D6A4F', light: '#D8F3DC', highlight: '#52B788', sidebar: '#1B4332' },
  BOLD_MODERN: { primary: '#1A1A2E', accent: '#E63946', light: '#F8F9FA', highlight: '#FF6B6B', sidebar: '#2B2D42' },
};

const FONT_PRESETS: Record<string, FontConfig> = {
  MODERN_TECH: { title: 'Segoe UI', body: ' ' },
  WARM_EXECUTIVE: { title: 'Georgia', body: ' ' },
  CLEAN_MINIMAL: { title: ' ', body: '' },
  CORPORATE: { title: 'Calibri', body: ' ' },
  NATURE_FRESH: { title: '', body: ' ' },
  BOLD_MODERN: { title: 'Arial Black', body: ' ' },
};

function resolveColors(args: Record<string, unknown>): ColorConfig {
  if (args['colors'] && typeof args['colors'] === 'object') {
    const c = args['colors'] as Record<string, string>;
    return {
      primary: c['primary'] || '#1A1A2E',
      accent: c['accent'] || '#1B998B',
      light: c['light'] || '#F5F5F5',
      highlight: c['highlight'] || '#3CDFFF',
      sidebar: c['sidebar'] || '#14514A',
    };
  }
  const scheme = (args['color_scheme'] as string) || 'MODERN_TECH';
  return COLOR_PRESETS[scheme] ?? COLOR_PRESETS['MODERN_TECH']!;
}

const DEFAULT_FONTS: FontConfig = { title: 'Segoe UI', body: ' ' };

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

function resolveStyle(args: Record<string, unknown>): DesignStyleName {
  const s = args['design_style'] as string;
  if (s === 'top_band' || s === 'clean') return s;
  return 'sidebar';
}

// Text truncation helper
function truncate(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

// Layout usage counters — enforces diversity limits per presentation
let layoutACount = 0;
let layoutBCount = 0;

/** Reset layout counters — called when a new presentation is created */
export function resetLayoutCounters(): void {
  layoutACount = 0;
  layoutBCount = 0;
}

// =============================================================================
// Internal slide assembly helpers
// =============================================================================

async function addSlideAndGetNumber(): Promise<number> {
  await powerpointClient.powerpointAddSlide(7);
  const resp = await powerpointClient.powerpointGetSlideCount();
  return Number(resp['slide_count'] || 1);
}

/** Delete a slide to clean up after body content failure */
async function cleanupFailedSlide(slideNum: number): Promise<void> {
  try {
    await powerpointClient.powerpointDeleteSlide(slideNum);
  } catch {
    // Cleanup is best-effort — don't throw
  }
}

/** Add common structural elements based on design style */
async function addStyleFrame(
  slideNum: number,
  style: DesignStyleName,
  colors: ColorConfig,
  fonts: FontConfig,
  title: string,
  slideNumberText?: string,
  isTitleOrClosing?: boolean,
): Promise<void> {
  if (isTitleOrClosing) return; // Title/closing handle their own frames

  // Background
  await powerpointClient.powerpointSetBackground(slideNum, { color: '#FFFFFF' });

  if (style === 'sidebar') {
    // Left sidebar (20pt wide for visibility)
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 20, 540, colors.primary);
    // Title
    await powerpointClient.powerpointAddTextbox(slideNum, truncate(title, 60), 50, 20, 820, 45, {
      fontName: fonts.title, fontSize: 24, bold: true, fontColor: colors.primary, alignment: 'left',
    });
    // Accent line
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 50, 68, 200, 3, colors.accent);
    // Footer bar
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 520, 960, 20, colors.primary);
    // Slide number
    if (slideNumberText) {
      await powerpointClient.powerpointAddTextbox(slideNum, slideNumberText, 890, 522, 50, 16, {
        fontName: fonts.body, fontSize: 9, fontColor: '#FFFFFF', alignment: 'right',
      });
    }
  } else if (style === 'top_band') {
    // Top band
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 960, 8, colors.accent);
    // Title
    await powerpointClient.powerpointAddTextbox(slideNum, truncate(title, 60), 50, 20, 860, 45, {
      fontName: fonts.title, fontSize: 24, bold: true, fontColor: colors.primary, alignment: 'left',
    });
    // Accent line
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 50, 68, 200, 3, colors.accent);
    // Footer line
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 530, 960, 10, colors.accent);
    // Slide number
    if (slideNumberText) {
      await powerpointClient.powerpointAddTextbox(slideNum, slideNumberText, 890, 532, 50, 8, {
        fontName: fonts.body, fontSize: 8, fontColor: '#FFFFFF', alignment: 'right',
      });
    }
  } else {
    // clean style — no sidebar or band
    // Title
    await powerpointClient.powerpointAddTextbox(slideNum, truncate(title, 60), 50, 25, 860, 45, {
      fontName: fonts.title, fontSize: 24, bold: true, fontColor: colors.primary, alignment: 'left',
    });
    // Accent line
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 50, 73, 150, 2, colors.accent);
    // Slide number (right-aligned, subtle)
    if (slideNumberText) {
      await powerpointClient.powerpointAddTextbox(slideNum, slideNumberText, 880, 515, 60, 16, {
        fontName: fonts.body, fontSize: 9, fontColor: '#999999', alignment: 'right',
      });
    }
  }
}

/** Content area top position after style frame */
function contentTop(style: DesignStyleName): number {
  return style === 'clean' ? 85 : 85;
}

/** Content area left offset */
function contentLeft(_style: DesignStyleName): number {
  return 50;
}

/** Content area width */
function contentWidth(style: DesignStyleName): number {
  return style === 'top_band' ? 860 : 820;
}

// =============================================================================
// Tool 1: Title Slide
// =============================================================================

const PPT_BUILD_TITLE_SLIDE_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_title_slide',
    description: 'Build a complete title slide with styled background, decorative elements, title, subtitle, and date text. One call = one finished title slide.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Main presentation title' },
        subtitle: { type: 'string', description: 'Subtitle or tagline' },
        date_text: { type: 'string', description: 'Date or author line' },
        color_scheme: { type: 'string', description: 'Preset name (MODERN_TECH, WARM_EXECUTIVE, CLEAN_MINIMAL, CORPORATE, NATURE_FRESH, BOLD_MODERN) or omit if using colors' },
        colors: { type: 'object', description: 'Custom colors: {primary, accent, light, highlight, sidebar}', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'], description: 'Visual frame style (default: sidebar)' },
        fonts: { type: 'object', description: 'Custom fonts: {title, body}', properties: { title: { type: 'string' }, body: { type: 'string' } } },
      },
      required: ['title'],
    },
  },
};

async function executeBuildTitleSlide(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = truncate((args['title'] as string) || 'Presentation', 50);
    const subtitle = truncate((args['subtitle'] as string) || '', 80);
    const dateText = truncate((args['date_text'] as string) || '', 60);

    const slideNum = await addSlideAndGetNumber();

    // Background
    await powerpointClient.powerpointSetBackground(slideNum, { color: colors.primary });

    if (style === 'sidebar') {
      // Sidebar accent (20pt wide for visibility)
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 20, 540, colors.sidebar);
      // Decorative line top
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 250, 165, 460, 3, colors.highlight);
      // Title
      await powerpointClient.powerpointAddTextbox(slideNum, title, 50, 180, 860, 85, {
        fontName: fonts.title, fontSize: 36, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      // Subtitle
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 275, 860, 40, {
          fontName: fonts.body, fontSize: 16, fontColor: colors.highlight, alignment: 'center',
        });
      }
      // Date/author
      if (dateText) {
        await powerpointClient.powerpointAddTextbox(slideNum, dateText, 50, 320, 860, 30, {
          fontName: fonts.body, fontSize: 11, fontColor: '#AAAAAA', alignment: 'center',
        });
      }
      // Decorative line bottom
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 250, 360, 460, 3, colors.highlight);
      // Footer bar
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 520, 960, 20, colors.accent);
    } else if (style === 'top_band') {
      // Top band
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 960, 60, colors.accent);
      // Title
      await powerpointClient.powerpointAddTextbox(slideNum, title, 50, 180, 860, 85, {
        fontName: fonts.title, fontSize: 36, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      // Accent line
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 380, 270, 200, 3, colors.highlight);
      // Subtitle
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 285, 860, 40, {
          fontName: fonts.body, fontSize: 16, fontColor: colors.highlight, alignment: 'center',
        });
      }
      // Date
      if (dateText) {
        await powerpointClient.powerpointAddTextbox(slideNum, dateText, 50, 330, 860, 30, {
          fontName: fonts.body, fontSize: 11, fontColor: '#AAAAAA', alignment: 'center',
        });
      }
      // Bottom band
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 530, 960, 10, colors.accent);
    } else {
      // clean style
      // Accent line top-center
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 380, 170, 200, 2, colors.accent);
      // Title
      await powerpointClient.powerpointAddTextbox(slideNum, title, 50, 185, 860, 85, {
        fontName: fonts.title, fontSize: 36, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      // Subtitle
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 280, 860, 40, {
          fontName: fonts.body, fontSize: 16, fontColor: colors.highlight, alignment: 'center',
        });
      }
      // Date
      if (dateText) {
        await powerpointClient.powerpointAddTextbox(slideNum, dateText, 50, 325, 860, 30, {
          fontName: fonts.body, fontSize: 11, fontColor: '#AAAAAA', alignment: 'center',
        });
      }
      // Accent line bottom-center
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 380, 365, 200, 2, colors.accent);
    }

    return { success: true, result: `Slide ${slideNum} built: TITLE (${style} style)` };
  } catch (error) {
    return { success: false, error: `Failed to build title slide: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 2: Layout A — Bullet Points
// =============================================================================

const PPT_BUILD_LAYOUT_A_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_a',
    description: 'Build a bullet-point slide. Use "■" for main items and "  – " for sub-details in body text. Max 4 main bullets with 2-3 sub-details each.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        body: { type: 'string', description: 'Bullet text using ■ and – markers, separated by \\n' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string', description: 'Slide number display text' },
      },
      required: ['title', 'body'],
    },
  },
};

async function executeBuildLayoutA(args: Record<string, unknown>): Promise<ToolResult> {
  layoutACount++;
  if (layoutACount > 3) {
    return {
      success: false,
      error: `Layout A limit exceeded (${layoutACount}/3 max). You MUST use a different layout: ppt_build_layout_b (two columns), ppt_build_layout_c (big number), ppt_build_layout_d (3 metrics), ppt_build_layout_e (process), or ppt_build_layout_f (table). Do NOT use ppt_build_layout_a again.`,
    };
  }
  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = (args['title'] as string) || '';
    let body = truncate((args['body'] as string) || '', 500);

    if (!body.trim()) {
      return { success: false, error: 'Layout A requires non-empty body text. Provide bullet content using ■ and – markers.' };
    }

    // Determine font size: if body has sub-details (– markers on separate lines), use 15pt
    // If body is sparse (only ■ lines without – sub-details), use 16pt to fill space better
    const hasSubDetails = body.split('\n').some(line => line.trim().startsWith('–') || line.trim().startsWith('- '));
    const bodyFontSize = hasSubDetails ? 15 : 16;

    // Add line spacing between ■ blocks for better readability when no sub-details
    if (!hasSubDetails) {
      body = body.replace(/\n■/g, '\n\n■');
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const top = contentTop(style);
    const left = contentLeft(style);
    const width = contentWidth(style);

    // Body background card (height capped to avoid footer overlap)
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, top, width, 420, colors.light);
    // Left accent strip on card — visual differentiator for bullet layouts
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, top, 4, 420, colors.accent);
    // Body text on card (shifted right for accent strip)
    await powerpointClient.powerpointAddTextbox(slideNum, body, left + 20, top + 10, width - 35, 400, {
      fontName: fonts.body, fontSize: bodyFontSize, fontColor: '#333333', alignment: 'left',
    });

    return { success: true, result: `Slide ${slideNum} built: Layout A (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout A: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 3: Layout B — Two-Column
// =============================================================================

const PPT_BUILD_LAYOUT_B_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_b',
    description: 'Build a two-column comparison slide with left/right headers and bodies. Good for before/after, pros/cons, AS-IS/TO-BE.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        left_header: { type: 'string', description: 'Left column header' },
        right_header: { type: 'string', description: 'Right column header' },
        left_body: { type: 'string', description: 'Left column body text' },
        right_body: { type: 'string', description: 'Right column body text' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string' },
      },
      required: ['title', 'left_header', 'right_header', 'left_body', 'right_body'],
    },
  },
};

async function executeBuildLayoutB(args: Record<string, unknown>): Promise<ToolResult> {
  layoutBCount++;
  if (layoutBCount > 4) {
    return {
      success: false,
      error: `Layout B limit exceeded (${layoutBCount}/4 max). Use other layouts: ppt_build_layout_c (big number), ppt_build_layout_d (3 metrics), ppt_build_layout_e (process), or ppt_build_layout_f (table). Do NOT use ppt_build_layout_b again.`,
    };
  }

  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = (args['title'] as string) || '';
    const leftBody = (args['left_body'] as string) || '';
    const rightBody = (args['right_body'] as string) || '';

    if (!leftBody.trim() && !rightBody.trim()) {
      return { success: false, error: 'Layout B requires non-empty body text in at least one column.' };
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const top = contentTop(style);
    const left = contentLeft(style);
    const width = contentWidth(style);
    const colWidth = Math.floor((width - 20) / 2); // 20pt gap for divider
    const rightLeft = left + colWidth + 20;

    // Left header background strip
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, top, colWidth, 32, colors.light);
    // Right header background strip
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', rightLeft, top, colWidth, 32, colors.light);
    // Left header
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['left_header'] as string) || '', 30), left + 8, top + 2, colWidth - 16, 28, {
      fontName: fonts.title, fontSize: 16, bold: true, fontColor: colors.accent, alignment: 'left',
    });
    // Right header
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['right_header'] as string) || '', 30), rightLeft + 8, top + 2, colWidth - 16, 28, {
      fontName: fonts.title, fontSize: 16, bold: true, fontColor: colors.primary, alignment: 'left',
    });
    // Left header accent underline
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, top + 32, colWidth, 2, colors.accent);
    // Right header accent underline (different color for contrast)
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', rightLeft, top + 32, colWidth, 2, colors.primary);
    // Divider
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left + colWidth + 8, top, 2, 350, colors.light);
    // Left body
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['left_body'] as string) || '', 400), left, top + 40, colWidth, 350, {
      fontName: fonts.body, fontSize: 15, fontColor: '#333333', alignment: 'left',
    });
    // Right body
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['right_body'] as string) || '', 400), rightLeft, top + 40, colWidth, 350, {
      fontName: fonts.body, fontSize: 15, fontColor: '#333333', alignment: 'left',
    });

    return { success: true, result: `Slide ${slideNum} built: Layout B (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout B: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 4: Layout C — Big Number
// =============================================================================

const PPT_BUILD_LAYOUT_C_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_c',
    description: 'Build a big-number spotlight slide. Highlights ONE key metric with a large number, label, and description.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        number: { type: 'string', description: 'The big number to display (e.g., "300%↑", "₩12.5")' },
        label: { type: 'string', description: 'Label below the number' },
        description: { type: 'string', description: 'Explanation text (2-3 sentences)' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string' },
      },
      required: ['title', 'number', 'label'],
    },
  },
};

async function executeBuildLayoutC(args: Record<string, unknown>): Promise<ToolResult> {
  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = (args['title'] as string) || '';
    const number = (args['number'] as string) || '';

    if (!number.trim()) {
      return { success: false, error: 'Layout C requires a non-empty number value.' };
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const left = contentLeft(style);
    const width = contentWidth(style);

    // Accent background band behind number area — spotlight effect
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, 88, width, 185, colors.light);
    // Top accent strip on band
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, 88, width, 4, colors.accent);
    // Bottom accent strip on band
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, 269, width, 2, colors.accent);
    // Big number (on accent band)
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['number'] as string) || '', 12), left, 100, width, 120, {
      fontName: fonts.title, fontSize: 72, bold: true, fontColor: colors.accent, alignment: 'center',
    });
    // Label
    await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['label'] as string) || '', 40), left, 230, width, 35, {
      fontName: fonts.body, fontSize: 18, fontColor: '#555555', alignment: 'center',
    });
    // Description background
    if (args['description']) {
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left + 30, 290, width - 60, 160, colors.light);
      await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['description'] as string), 400), left + 50, 300, width - 100, 140, {
        fontName: fonts.body, fontSize: 14, fontColor: '#333333', alignment: 'center',
      });
    }

    return { success: true, result: `Slide ${slideNum} built: Layout C (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout C: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 5: Layout D — Three Metrics
// =============================================================================

const PPT_BUILD_LAYOUT_D_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_d',
    description: 'Build a three-metrics dashboard slide. Shows 3 KPIs side by side with numbers, labels, descriptions, and an insight summary.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        metrics: {
          type: 'array',
          description: 'Exactly 3 metrics, each with number (max 6 chars), label, and description',
          items: {
            type: 'object',
            properties: {
              number: { type: 'string', description: 'Short numeric value (max 6 chars, e.g., "$35.7B", "96.8%")' },
              label: { type: 'string', description: 'Metric label (units go here)' },
              description: { type: 'string', description: '2-3 sentence description' },
            },
            required: ['number', 'label'],
          },
        },
        insight_text: { type: 'string', description: 'Summary insight paragraph below metrics' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string' },
      },
      required: ['title', 'metrics'],
    },
  },
};

async function executeBuildLayoutD(args: Record<string, unknown>): Promise<ToolResult> {
  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = (args['title'] as string) || '';
    const metrics = (args['metrics'] as Array<Record<string, string>>) || [];

    if (metrics.length < 3) {
      return { success: false, error: 'Layout D requires exactly 3 metrics' };
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const baseLeft = contentLeft(style);
    const totalWidth = contentWidth(style);
    const metricWidth = Math.floor((totalWidth - 40) / 3); // 20pt gaps × 2
    const positions = [
      baseLeft,
      baseLeft + metricWidth + 20,
      baseLeft + metricWidth * 2 + 40,
    ];

    // Build 3 metric blocks
    for (let i = 0; i < 3; i++) {
      const m = metrics[i]!;
      const x = positions[i]!;

      // Metric background — taller for more content
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', x, 90, metricWidth, 260, colors.light);
      // Accent top strip on metric card — visual differentiator for dashboard layouts
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', x, 90, metricWidth, 4, colors.accent);
      // Number
      await powerpointClient.powerpointAddTextbox(slideNum, truncate(m['number'] || '', 8), x + 5, 102, metricWidth - 10, 70, {
        fontName: fonts.title, fontSize: 44, bold: true, fontColor: colors.accent, alignment: 'center',
      });
      // Label
      await powerpointClient.powerpointAddTextbox(slideNum, truncate(m['label'] || '', 20), x + 5, 175, metricWidth - 10, 25, {
        fontName: fonts.body, fontSize: 13, fontColor: '#666666', alignment: 'center',
      });
      // Description
      if (m['description']) {
        await powerpointClient.powerpointAddTextbox(slideNum, truncate(m['description'], 150), x + 5, 205, metricWidth - 10, 130, {
          fontName: fonts.body, fontSize: 11, fontColor: '#555555', alignment: 'center',
        });
      }
    }

    // Dividers between metrics
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', positions[1]! - 11, 100, 1, 240, colors.accent);
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', positions[2]! - 11, 100, 1, 240, colors.accent);

    // Insight box — moved closer to metrics
    if (args['insight_text']) {
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', baseLeft, 370, totalWidth, 85, colors.light);
      // Left accent strip on insight box
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', baseLeft, 370, 4, 85, colors.accent);
      await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['insight_text'] as string), 250), baseLeft + 20, 380, totalWidth - 35, 65, {
        fontName: fonts.body, fontSize: 13, italic: true, fontColor: colors.primary, alignment: 'left',
      });
    }

    return { success: true, result: `Slide ${slideNum} built: Layout D (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout D: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 6: Layout E — Process / Timeline
// =============================================================================

const PPT_BUILD_LAYOUT_E_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_e',
    description: 'Build a process/timeline slide with exactly 3 steps shown as circles with connecting arrows. Max 3 steps.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        steps: {
          type: 'array',
          description: 'Exactly 3 steps, each with a short label (max 8 chars) and description',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Step label (max 8 Korean chars)' },
              description: { type: 'string', description: 'Step description (1-3 sentences)' },
            },
            required: ['label'],
          },
        },
        insight_text: { type: 'string', description: 'Summary insight below the steps' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string' },
      },
      required: ['title', 'steps'],
    },
  },
};

async function executeBuildLayoutE(args: Record<string, unknown>): Promise<ToolResult> {
  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const title = (args['title'] as string) || '';
    const steps = (args['steps'] as Array<Record<string, string>>) || [];

    if (steps.length < 3) {
      return { success: false, error: 'Layout E requires exactly 3 steps' };
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const baseLeft = contentLeft(style);
    const totalWidth = contentWidth(style);
    const stepWidth = 250;
    const stepPositions = [
      baseLeft + 10,
      baseLeft + Math.floor(totalWidth / 2) - Math.floor(stepWidth / 2),
      baseLeft + totalWidth - stepWidth - 10,
    ];
    const circleSize = 60;

    for (let i = 0; i < 3; i++) {
      const step = steps[i]!;
      const x = stepPositions[i]!;
      const circleX = x + Math.floor(stepWidth / 2) - Math.floor(circleSize / 2);

      // Background card for step description area — visual differentiator for process layouts
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', x, 170, stepWidth, 160, colors.light);
      // Circle
      await powerpointClient.powerpointAddShape(slideNum, 'oval', circleX, 100, circleSize, circleSize, colors.accent);
      // Step number inside circle
      await powerpointClient.powerpointAddTextbox(slideNum, String(i + 1), circleX, 110, circleSize, 40, {
        fontName: fonts.title, fontSize: 22, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      // Step label
      await powerpointClient.powerpointAddTextbox(slideNum, truncate(step['label'] || '', 12), x + 10, 175, stepWidth - 20, 28, {
        fontName: fonts.title, fontSize: 14, bold: true, fontColor: colors.primary, alignment: 'center',
      });
      // Accent underline under step label
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', x + 60, 203, stepWidth - 120, 2, colors.accent);
      // Step description
      if (step['description']) {
        await powerpointClient.powerpointAddTextbox(slideNum, truncate(step['description'], 150), x + 10, 210, stepWidth - 20, 115, {
          fontName: fonts.body, fontSize: 11, fontColor: '#555555', alignment: 'center',
        });
      }

      // Connecting arrow (between circles, not after last)
      if (i < 2) {
        const arrowX = circleX + circleSize + 5;
        const nextCircleX = stepPositions[i + 1]! + Math.floor(stepWidth / 2) - Math.floor(circleSize / 2);
        const arrowWidth = nextCircleX - arrowX - 5;
        if (arrowWidth > 0) {
          await powerpointClient.powerpointAddShape(slideNum, 'rectangle', arrowX, 128, arrowWidth, 3, colors.highlight);
        }
      }
    }

    // Insight box
    if (args['insight_text']) {
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', baseLeft, 350, totalWidth, 85, colors.light);
      // Left accent strip on insight box
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', baseLeft, 350, 4, 85, colors.accent);
      await powerpointClient.powerpointAddTextbox(slideNum, truncate((args['insight_text'] as string), 200), baseLeft + 20, 360, totalWidth - 35, 65, {
        fontName: fonts.body, fontSize: 13, italic: true, fontColor: colors.primary, alignment: 'left',
      });
    }

    return { success: true, result: `Slide ${slideNum} built: Layout E (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout E: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 7: Layout F — Table
// =============================================================================

const PPT_BUILD_LAYOUT_F_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_layout_f',
    description: 'Build a table slide. Provide table_data as a 2D array where row 0 is headers. Automatically styles header row and alternating rows.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Slide title' },
        table_data: {
          type: 'array',
          description: '2D array: first row = headers, remaining rows = data. Example: [["Name","Score"],["Alice","95"],["Bob","88"]]',
          items: { type: 'array', items: { type: 'string' } },
        },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
        slide_number_text: { type: 'string' },
      },
      required: ['title', 'table_data'],
    },
  },
};

async function executeBuildLayoutF(args: Record<string, unknown>): Promise<ToolResult> {
  let slideNum = 0;
  try {
    const colors = resolveColors(args);
    const style = resolveStyle(args);
    const fonts = resolveFonts(args);
    const title = (args['title'] as string) || '';
    const tableData = (args['table_data'] as string[][]) || [];

    if (tableData.length < 2) {
      return { success: false, error: 'Layout F requires at least 2 rows (1 header + 1 data)' };
    }

    slideNum = await addSlideAndGetNumber();
    await addStyleFrame(slideNum, style, colors, fonts, title, args['slide_number_text'] as string);

    const left = contentLeft(style);
    const width = contentWidth(style);
    const rows = tableData.length;
    const cols = tableData[0]!.length;

    // Truncate cell data
    const truncatedData = tableData.map(row =>
      row.map(cell => truncate(cell || '', 50))
    );

    // Accent line above table — visual differentiator for table layouts
    await powerpointClient.powerpointAddShape(slideNum, 'rectangle', left, 83, width, 2, colors.accent);
    // Add table
    await powerpointClient.powerpointAddTable(slideNum, rows, cols, left, 88, width, 345, truncatedData);

    // Style table (header row with accent color)
    // Get shape list to find the table index
    const shapeList = await powerpointClient.powerpointGetShapeList(slideNum);
    const shapeCount = Number(shapeList?.['count'] ?? (Array.isArray(shapeList?.['shapes']) ? shapeList['shapes'].length : 0));
    if (shapeCount > 0) {
      await powerpointClient.powerpointSetTableStyle(slideNum, shapeCount, {
        headerRowFill: colors.accent,
        alternateRowFill: colors.light,
        borderColor: '#D0D0D0',
      });
    }

    return { success: true, result: `Slide ${slideNum} built: Layout F table ${rows}×${cols} (${style} style)` };
  } catch (error) {
    if (slideNum > 0) await cleanupFailedSlide(slideNum);
    return { success: false, error: `Failed to build Layout F: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Tool 8: Closing Slide
// =============================================================================

const PPT_BUILD_CLOSING_SLIDE_DEF: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ppt_build_closing_slide',
    description: 'Build a farewell/thank-you closing slide with dark background. ONLY use as the absolute LAST slide before save. Do NOT use for ANY content sections. text parameter: ONLY short farewell like "" or "Thank You" (max 15 chars). NEVER put long sentences in text.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Main closing text (e.g., "", "Thank You")' },
        subtitle: { type: 'string', description: 'Contact info or tagline' },
        color_scheme: { type: 'string' },
        colors: { type: 'object', properties: { primary: { type: 'string' }, accent: { type: 'string' }, light: { type: 'string' }, highlight: { type: 'string' }, sidebar: { type: 'string' } } },
        design_style: { type: 'string', enum: ['sidebar', 'top_band', 'clean'] },
        fonts: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } },
      },
      required: ['text'],
    },
  },
};

async function executeBuildClosingSlide(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const colors = resolveColors(args);
    const fonts = resolveFonts(args);
    const style = resolveStyle(args);
    const text = truncate((args['text'] as string) || '', 30);
    const subtitle = truncate((args['subtitle'] as string) || '', 150);

    const slideNum = await addSlideAndGetNumber();

    // Background
    await powerpointClient.powerpointSetBackground(slideNum, { color: colors.primary });

    if (style === 'sidebar') {
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 20, 540, colors.accent);
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 250, 190, 460, 3, colors.highlight);
      await powerpointClient.powerpointAddTextbox(slideNum, text, 50, 200, 860, 80, {
        fontName: fonts.title, fontSize: 42, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 290, 860, 80, {
          fontName: fonts.body, fontSize: 14, fontColor: colors.highlight, alignment: 'center',
        });
      }
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 250, 380, 460, 3, colors.highlight);
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 520, 960, 20, colors.accent);
    } else if (style === 'top_band') {
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 0, 960, 60, colors.accent);
      await powerpointClient.powerpointAddTextbox(slideNum, text, 50, 200, 860, 80, {
        fontName: fonts.title, fontSize: 42, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 290, 860, 80, {
          fontName: fonts.body, fontSize: 14, fontColor: colors.highlight, alignment: 'center',
        });
      }
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 0, 530, 960, 10, colors.accent);
    } else {
      // clean
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 380, 190, 200, 2, colors.accent);
      await powerpointClient.powerpointAddTextbox(slideNum, text, 50, 200, 860, 80, {
        fontName: fonts.title, fontSize: 42, bold: true, fontColor: '#FFFFFF', alignment: 'center',
      });
      if (subtitle) {
        await powerpointClient.powerpointAddTextbox(slideNum, subtitle, 50, 290, 860, 80, {
          fontName: fonts.body, fontSize: 14, fontColor: colors.highlight, alignment: 'center',
        });
      }
      await powerpointClient.powerpointAddShape(slideNum, 'rectangle', 380, 380, 200, 2, colors.accent);
    }

    return { success: true, result: `Slide ${slideNum} built: CLOSING (${style} style)` };
  } catch (error) {
    return { success: false, error: `Failed to build closing slide: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// =============================================================================
// Export all builder tools
// =============================================================================

export const pptBuildTitleSlideTool: LLMSimpleTool = {
  definition: PPT_BUILD_TITLE_SLIDE_DEF,
  execute: executeBuildTitleSlide,
  categories: OFFICE_CATEGORIES,
  description: 'Build complete title slide',
};

export const pptBuildLayoutATool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_A_DEF,
  execute: executeBuildLayoutA,
  categories: OFFICE_CATEGORIES,
  description: 'Build bullet-point slide',
};

export const pptBuildLayoutBTool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_B_DEF,
  execute: executeBuildLayoutB,
  categories: OFFICE_CATEGORIES,
  description: 'Build two-column slide',
};

export const pptBuildLayoutCTool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_C_DEF,
  execute: executeBuildLayoutC,
  categories: OFFICE_CATEGORIES,
  description: 'Build big-number slide',
};

export const pptBuildLayoutDTool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_D_DEF,
  execute: executeBuildLayoutD,
  categories: OFFICE_CATEGORIES,
  description: 'Build three-metrics slide',
};

export const pptBuildLayoutETool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_E_DEF,
  execute: executeBuildLayoutE,
  categories: OFFICE_CATEGORIES,
  description: 'Build process/timeline slide',
};

export const pptBuildLayoutFTool: LLMSimpleTool = {
  definition: PPT_BUILD_LAYOUT_F_DEF,
  execute: executeBuildLayoutF,
  categories: OFFICE_CATEGORIES,
  description: 'Build table slide',
};

export const pptBuildClosingSlideTool: LLMSimpleTool = {
  definition: PPT_BUILD_CLOSING_SLIDE_DEF,
  execute: executeBuildClosingSlide,
  categories: OFFICE_CATEGORIES,
  description: 'Build closing slide',
};

export const layoutBuilderTools: LLMSimpleTool[] = [
  pptBuildTitleSlideTool,
  pptBuildLayoutATool,
  pptBuildLayoutBTool,
  pptBuildLayoutCTool,
  pptBuildLayoutDTool,
  pptBuildLayoutETool,
  pptBuildLayoutFTool,
  pptBuildClosingSlideTool,
];
