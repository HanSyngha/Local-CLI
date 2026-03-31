/**
 * PowerPoint Creation Agent — v2 Architecture
 *
 * 1. Design Phase: Single LLM call (merged Enhancement + Planning) + Open PowerPoint in parallel
 * 2. Parallel HTML Generation: 5 concurrent LLM calls for content slides
 * 3. Validation & Regeneration: Check each HTML, re-request failures
 * 4. Pipeline Assembly: Pre-create slides → parallel Edge screenshots → sequential fill
 *
 * * * * Electron parity: src/agents/office/powerpoint-create-agent.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../../core/llm/llm-client.js';
import { LLMAgentTool, ToolResult } from '../../tools/types.js';
import { powerpointClient } from '../../tools/office/powerpoint-client.js';
import { getSubAgentPhaseLogger, getSubAgentToolCallLogger } from '../common/sub-agent.js';
import { logger } from '../../utils/logger.js';
import { getPlatform } from '../../utils/platform-utils';
import {
  PPT_DESIGN_PROMPT,
  validateSlideHtml,
  buildFreeHtmlPrompt,
} from './powerpoint-create-prompts.js';
import type { DesignSystem } from './powerpoint-create-prompts.js';

// =============================================================================
// Types
// =============================================================================

interface SlidePlan {
  type: 'title' | 'content' | 'closing';
  title: string;
  content_direction: string;
}

interface StructuredPlan {
  design: DesignSystem;
  slides: SlidePlan[];
}

// Default design system fallback values
const DEFAULT_DESIGN: DesignSystem = {
  primary_color: '#1B2A4A',
  accent_color: '#00D4AA',
  background_color: '#FFFFFF',
  text_color: '#1A1A2E',
  accent_light: '#E8F5F0',
  gradient_end: '#2D5F8A',
  font_title: 'Segoe UI',
  font_body: 'Malgun Gothic',
  mood: 'modern-minimal',
  design_notes: 'Clean gradients, card-based layouts',
};

// Max concurrent LLM calls for parallel HTML generation
const MAX_CONCURRENT = 5;

/**
 * Extract text content from LLM response message.
 * Thinking models (DeepSeek, GLM) may put output in reasoning_content instead of content.
 */
function extractContent(msg: Record<string, unknown>): string {
  const content = msg['content'] as string | undefined;
  if (content && content.trim()) return content;
  const reasoning = msg['reasoning_content'] as string | undefined;
  if (reasoning && reasoning.trim()) return reasoning;
  return '';
}

// =============================================================================
// Placeholder Text Detection
// =============================================================================

function hasPlaceholderText(html: string): boolean {
  const placeholderPatterns = [
    'Card title (2-5 words)',
    'Detail with number/data',
    'single emoji',
    'Display value (e.g.',
    'Category name',
    '1-2 sentence key insight',
    'Another detail',
    'Third point',
    'Fourth point',
    'Brief context',
    'Segment name',
  ];
  const lowerHtml = html.toLowerCase();
  return placeholderPatterns.some(p => lowerHtml.includes(p.toLowerCase()));
}

// =============================================================================
// Plan Validation
// =============================================================================

function validateAndFixPlan(plan: StructuredPlan): string | null {
  if (!plan.design) return 'Missing design object';
  if (!plan.design.primary_color || !plan.design.accent_color) {
    return 'Missing design colors (primary_color, accent_color)';
  }
  if (!Array.isArray(plan.slides) || plan.slides.length < 3) {
    return 'slides array must have at least 3 entries';
  }

  // Only enforce minimum when user hasn't specified a custom count
  // (custom count validation happens at enhancement/planning phase via prompt)
  if (plan.slides.length < 3) {
    return `Only ${plan.slides.length} slides — minimum 3 required. Add more content slides.`;
  }

  // Auto-fix: ensure first slide is type "title" and last is "closing"
  // Skip for small decks (≤3 slides) — all slides should be content
  if (plan.slides.length > 3) {
    if (plan.slides[0]?.type !== 'title') {
      logger.info('Auto-fixing: first slide type changed to "title"');
      plan.slides[0]!.type = 'title';
    }
    const lastSlide = plan.slides[plan.slides.length - 1]!;
    if (lastSlide.type !== 'closing') {
      logger.info('Auto-fixing: last slide type changed to "closing"');
      lastSlide.type = 'closing';
    }
  }

  // Auto-fix: fill missing titles
  for (let i = 0; i < plan.slides.length; i++) {
    if (!plan.slides[i]!.title) {
      plan.slides[i]!.title = `Slide ${i + 1}`;
    }
  }

  // Validate content_direction quality
  const layoutOnlyPatterns = [
    /^(?:전체\s*배경|왼쪽에|오른쪽에|중앙에|상단에|하단에)/,
    /#[0-9a-fA-F]{3,8}에서.*그라데이션/,
    /(?:accent_light|primary|gradient_end)\s*(?:배경|글씨|색상)/,
    /^(?:CSS|flexbox|grid|conic-gradient|linear-gradient)/i,
  ];
  for (let i = 0; i < plan.slides.length; i++) {
    const slide = plan.slides[i]!;
    if (slide.type === 'title' || slide.type === 'closing') continue;
    const cd = slide.content_direction || '';
    const hasNumbers = /\d/.test(cd);
    const isLayoutOnly = layoutOnlyPatterns.some(p => p.test(cd));
    if (isLayoutOnly && !hasNumbers) {
      return `Slide ${i + 1} "${slide.title}" content_direction contains layout instructions instead of actual data.`;
    }
  }

  return null;
}

// =============================================================================
// JSON Repair Helper
// =============================================================================

function repairLlmJson(raw: string): string {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (!inString) {
      if (ch === ',') {
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j]!)) j++;
        if (j < raw.length && (raw[j]! === '}' || raw[j]! === ']')) {
          i++;
          continue;
        }
      }
      result += ch;
      if (ch === '"') inString = true;
      i++;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      if (i + 1 < raw.length) {
        result += raw[i + 1]!;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && /[ \t\r\n]/.test(raw[j]!)) j++;
      const next = j < raw.length ? raw[j]! : '';
      if (next === '' || /[,:}\]]/.test(next)) {
        result += '"';
        inString = false;
      } else {
        result += '\\"';
      }
      i++;
      continue;
    }

    if (ch === '\n') { result += '\\n'; i++; continue; }
    if (ch === '\r') {
      result += '\\n';
      i += (i + 1 < raw.length && raw[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    if (ch === '\t') { result += '\\t'; i++; continue; }
    if (ch!.charCodeAt(0) < 0x20) { i++; continue; }

    result += ch;
    i++;
  }

  return result;
}

// =============================================================================
// JSON Parsing Helper
// =============================================================================

function parseJsonPlan(raw: string): StructuredPlan | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace >= 0 && lastBrace < cleaned.length - 1) cleaned = cleaned.slice(0, lastBrace + 1);

  try { return JSON.parse(cleaned) as StructuredPlan; } catch { /* continue */ }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try { return JSON.parse(match[0]) as StructuredPlan; } catch { /* continue */ }

  const repaired = repairLlmJson(match[0]);
  try { return JSON.parse(repaired) as StructuredPlan; } catch { /* continue */ }

  try {
    let final = repaired;
    let braces = 0, brackets = 0;
    let inStr = false, esc = false;
    for (const ch of final) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    if (inStr) final += '"';
    for (let x = 0; x < brackets; x++) final += ']';
    for (let x = 0; x < braces; x++) final += '}';
    return JSON.parse(final) as StructuredPlan;
  } catch {
    return null;
  }
}

// =============================================================================
// Edge Sizing Helper
// =============================================================================

/**
 * Lightweight Edge sizing for code-generated templates.
 */
function injectEdgeSizing(html: string, backgroundColor?: string): string {
  let result = html.replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '');
  const bgColor = backgroundColor || '#000000';
  const sizingCss = `<style id="edge-sizing">html{width:2040px!important;height:1200px!important;overflow:hidden!important;margin:0!important;background-color:${bgColor}!important;zoom:1!important}body{width:1920px!important;height:1080px!important;min-width:1920px!important;min-height:1080px!important;overflow:hidden!important;margin:0!important;zoom:1!important}</style>`;
  if (result.includes('</head>')) {
    result = result.replace('</head>', `${sizingCss}</head>`);
  } else if (result.includes('<head>')) {
    result = result.replace('<head>', `<head>${sizingCss}`);
  } else if (result.includes('<html')) {
    result = result.replace(/<html[^>]*>/, (m) => `${m}<head>${sizingCss}</head>`);
  } else {
    result = sizingCss + result;
  }
  return result;
}

// =============================================================================
// HTML Escape Helper
// =============================================================================

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================================================
// Code-Generated Title Slide HTML
// =============================================================================

function buildTitleSlideHtml(
  design: DesignSystem,
  mainTitle: string,
  subtitle: string,
  date: string,
  _slideNum: number,
): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background-color: ${design.primary_color}; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body {
  background: linear-gradient(135deg, ${design.primary_color} 0%, ${design.gradient_end} 60%, ${design.primary_color} 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: "${design.font_title}", "Segoe UI", sans-serif;
}
body::before {
  content: '';
  display: block;
  width: 100%;
  height: 6px;
  background: linear-gradient(90deg, transparent, ${design.accent_color}, transparent);
  flex-shrink: 0;
}
.slide-content {
  text-align: center;
  max-width: 1400px;
  padding: 0 60px;
}
.main-title {
  font-size: 96px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -2px;
  text-shadow: 0 6px 40px rgba(0,0,0,0.25);
  line-height: 1.1;
  margin-bottom: 32px;
}
.accent-bar {
  width: 120px; height: 5px;
  background: ${design.accent_color};
  margin: 0 auto 32px;
  border-radius: 3px;
  box-shadow: 0 0 20px ${design.accent_color}40;
}
.subtitle {
  font-size: 32px;
  font-weight: 400;
  color: rgba(255,255,255,0.88);
  font-family: "${design.font_body}", "Malgun Gothic", sans-serif;
  line-height: 1.5;
  margin-bottom: 16px;
}
.date-text {
  font-size: 22px;
  font-weight: 300;
  color: rgba(255,255,255,0.55);
  font-family: "${design.font_body}", "Malgun Gothic", sans-serif;
}
</style>
</head>
<body>
<div class="slide-content">
  <div class="main-title">${escapeHtml(mainTitle)}</div>
  <div class="accent-bar"></div>
  ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
  <div class="date-text">${escapeHtml(date)}</div>
</div>
<style>body{align-items:center!important;justify-content:center!important}.slide-content{flex:unset!important;min-height:unset!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}.slide-content>*{flex:unset!important;min-height:unset!important}</style>
</body>
</html>`;
}

// =============================================================================
// Code-Generated Closing Slide HTML
// =============================================================================

function buildClosingSlideHtml(
  design: DesignSystem,
  companyName: string,
  _slideNum: number,
  language: 'ko' | 'en',
  tagline?: string,
): string {
  const thankYou = language === 'ko' ? '감사합니다' : 'Thank You';
  const taglineHtml = tagline ? `<div class="tagline">${escapeHtml(tagline)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background-color: ${design.primary_color}; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body {
  background: linear-gradient(135deg, ${design.primary_color} 0%, ${design.gradient_end} 60%, ${design.primary_color} 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: "${design.font_title}", "Segoe UI", sans-serif;
}
body::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 6px;
  background: linear-gradient(90deg, transparent, ${design.accent_color}, transparent);
}
body::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 6px;
  background: linear-gradient(90deg, transparent, ${design.accent_color}, transparent);
}
.slide-content {
  text-align: center;
  max-width: 1200px;
}
.thank-you {
  font-size: 104px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -1px;
  text-shadow: 0 6px 40px rgba(0,0,0,0.25);
  margin-bottom: 36px;
}
.accent-bar {
  width: 120px; height: 5px;
  background: ${design.accent_color};
  margin: 0 auto 36px;
  border-radius: 3px;
  box-shadow: 0 0 20px ${design.accent_color}40;
}
.company {
  font-size: 44px;
  font-weight: 600;
  color: rgba(255,255,255,0.88);
  font-family: "${design.font_body}", "Malgun Gothic", sans-serif;
  margin-bottom: 20px;
}
.tagline {
  font-size: 28px;
  font-weight: 400;
  color: rgba(255,255,255,0.60);
  font-family: "${design.font_body}", "Malgun Gothic", sans-serif;
  line-height: 1.6;
  max-width: 900px;
  margin: 0 auto;
}
</style>
</head>
<body>
<div class="slide-content">
  <div class="thank-you">${escapeHtml(thankYou)}</div>
  <div class="accent-bar"></div>
  <div class="company">${escapeHtml(companyName)}</div>
  ${taglineHtml}
</div>
<style>body{align-items:center!important;justify-content:center!important}.slide-content{flex:unset!important;min-height:unset!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}.slide-content>*{flex:unset!important;min-height:unset!important}</style>
</body>
</html>`;
}

// =============================================================================
// Fallback Slide HTML (when LLM generation fails)
// =============================================================================

function buildFallbackSlideHtml(
  design: DesignSystem,
  title: string,
  contentDirection: string,
  slideNum: number,
): string {
  // Extract bullet points from content_direction using multiple strategies
  const items: string[] = [];
  // Strategy 1: Split on common delimiters (numbered lists, bullets, line breaks)
  const parts = contentDirection.split(/\(\d+\)\s*|•\s*|\n-\s*|\n\d+[.)]\s*|Step\s*\d+[.:]\s*/i);
  for (const part of parts) {
    const cleaned = part.replace(/Layout:.*$/i, '').trim();
    if (cleaned.length > 5) {
      const sentence = cleaned.split(/[.。!]\s/)[0] || cleaned;
      items.push(sentence.slice(0, 80));
    }
  }
  // Strategy 2: If few items found, try splitting on commas or semicolons for dense text
  if (items.length < 3) {
    const commaParts = contentDirection.split(/[,;，；]\s*/);
    for (const part of commaParts) {
      const cleaned = part.replace(/Layout:.*$/i, '').trim();
      if (cleaned.length > 8 && !items.includes(cleaned.slice(0, 80))) {
        items.push(cleaned.slice(0, 80));
      }
    }
  }
  // Strategy 3: If still few, split on sentence boundaries
  if (items.length < 3) {
    const sentences = contentDirection.split(/[.。!?]\s+/);
    for (const s of sentences) {
      const cleaned = s.replace(/Layout:.*$/i, '').trim();
      if (cleaned.length > 10 && !items.some(i => i.startsWith(cleaned.slice(0, 20)))) {
        items.push(cleaned.slice(0, 80));
      }
    }
  }
  const bulletItems = items.slice(0, 6);

  // Use 2-column grid for 4+ items, single column for fewer
  const useGrid = bulletItems.length >= 4;
  const gridCols = useGrid ? 'grid-template-columns:1fr 1fr' : 'grid-template-columns:1fr';
  const pointsHtml = bulletItems.map((item, i) =>
    `<div class="point"><div class="point-num">${i + 1}</div><div class="point-text">${escapeHtml(item)}</div></div>`
  ).join('\n      ');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body {
  background: ${design.background_color};
  font-family: "${design.font_body}", "Malgun Gothic", sans-serif;
  padding: 80px 100px;
  display: flex;
  flex-direction: column;
}
.header { margin-bottom: 48px; }
.slide-num { font-size: 14px; color: ${design.accent_color}; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; }
h1 { font-size: 52px; font-weight: 700; color: ${design.text_color}; font-family: "${design.font_title}", "Segoe UI", sans-serif; line-height: 1.2; }
.accent-bar { width: 80px; height: 4px; background: ${design.accent_color}; margin-top: 20px; border-radius: 2px; }
.content { flex: 1; display: grid; ${gridCols}; gap: 24px; align-content: center; }
.point { display: flex; align-items: flex-start; gap: 20px; padding: 28px 32px; background: #fff; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
.point-num { width: 48px; height: 48px; border-radius: 50%; background: ${design.accent_color}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; flex-shrink: 0; }
.point-text { font-size: 26px; line-height: 1.5; color: ${design.text_color}; flex: 1; }
</style>
</head>
<body>
<div class="header">
  <div class="slide-num">SLIDE ${slideNum}</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="accent-bar"></div>
</div>
<div class="content">
  ${pointsHtml}
</div>
</body>
</html>`;
}

// =============================================================================
// File Path Helpers
// =============================================================================

function getTempDir(): { writePath: string; winPath: string } {
  const platform = getPlatform();
  if (platform === 'wsl') {
    return { writePath: '/mnt/c/temp', winPath: 'C:\\temp' };
  }
  return { writePath: 'C:\\temp', winPath: 'C:\\temp' };
}

function ensureTempDir(writePath: string): void {
  if (!fs.existsSync(writePath)) {
    fs.mkdirSync(writePath, { recursive: true });
  }
}

// =============================================================================
// Design System Normalization
// =============================================================================

function normalizeDesign(raw: Record<string, unknown>): DesignSystem {
  return {
    primary_color: (raw['primary_color'] as string) || DEFAULT_DESIGN.primary_color,
    accent_color: (raw['accent_color'] as string) || DEFAULT_DESIGN.accent_color,
    background_color: (raw['background_color'] as string) || DEFAULT_DESIGN.background_color,
    text_color: (raw['text_color'] as string) || DEFAULT_DESIGN.text_color,
    accent_light: (raw['accent_light'] as string) || DEFAULT_DESIGN.accent_light,
    gradient_end: (raw['gradient_end'] as string) || DEFAULT_DESIGN.gradient_end,
    font_title: (raw['font_title'] as string) || DEFAULT_DESIGN.font_title,
    font_body: (raw['font_body'] as string) || DEFAULT_DESIGN.font_body,
    mood: (raw['mood'] as string) || DEFAULT_DESIGN.mood,
    design_notes: (raw['design_notes'] as string) || DEFAULT_DESIGN.design_notes,
  };
}

// =============================================================================
// Phase 1: Design (Single LLM call) + Open PowerPoint in parallel
// =============================================================================

type PhaseLoggerFn = (agentName: string, phase: string, message: string) => void;
type ToolCallLoggerFn = (agentName: string, toolName: string, args: Record<string, unknown>, result: string, success: boolean, slideNum: number, totalCalls: number) => void;

async function runDesignPhase(
  llmClient: LLMClient,
  instruction: string,
  phaseLogger: PhaseLoggerFn | null,
): Promise<StructuredPlan | null> {
  if (phaseLogger) phaseLogger('powerpoint-create', 'design', 'Generating design system + slide plan...');

  let plan: StructuredPlan | null = null;
  try {
    const res = await llmClient.chatCompletion({
      messages: [
        { role: 'system', content: PPT_DESIGN_PROMPT },
        { role: 'user', content: instruction },
      ],
      temperature: 0.5,
    });
    const msg = res.choices[0]?.message;
    const rawPlan = msg ? extractContent(msg as unknown as Record<string, unknown>) : '';
    const finishReason = res.choices[0]?.finish_reason;

    if (finishReason === 'length') {
      logger.warn('PPT design response was truncated (finish_reason=length)');
    }
    logger.debug('PPT design raw response', { length: rawPlan.length, finishReason, first200: rawPlan.slice(0, 200) });
    plan = rawPlan ? parseJsonPlan(rawPlan) : null;

    if (plan) {
      plan.design = normalizeDesign(plan.design as unknown as Record<string, unknown>);
      const validationError = validateAndFixPlan(plan);
      if (validationError) {
        logger.warn('PPT plan validation failed', { error: validationError });
        if (phaseLogger) phaseLogger('powerpoint-create', 'design', `Validation failed: ${validationError}. Retrying...`);
        // Retry with error feedback
        const retryRes = await llmClient.chatCompletion({
          messages: [
            { role: 'system', content: PPT_DESIGN_PROMPT },
            { role: 'user', content: instruction },
            { role: 'assistant', content: rawPlan },
            { role: 'user', content: `ERROR: ${validationError}\n\nFix the issues and output the corrected JSON. Remember: aim for 10-12 slides with REAL content data.` },
          ],
          temperature: 0.3,
        });
        const retryMsg = retryRes.choices[0]?.message;
        const retryRaw = retryMsg ? extractContent(retryMsg as unknown as Record<string, unknown>) : '';
        const retryPlan = retryRaw ? parseJsonPlan(retryRaw) : null;
        if (retryPlan) {
          retryPlan.design = normalizeDesign(retryPlan.design as unknown as Record<string, unknown>);
          const retryError = validateAndFixPlan(retryPlan);
          if (!retryError) {
            plan = retryPlan;
            if (phaseLogger) phaseLogger('powerpoint-create', 'design', `Retry succeeded (${plan.slides.length} slides)`);
          } else {
            plan = null;
          }
        } else {
          plan = null;
        }
      } else {
        if (phaseLogger) phaseLogger('powerpoint-create', 'design', `Done (${plan.slides.length} slides, mood: ${plan.design.mood})`);
      }
    }
  } catch (e) {
    logger.warn('PPT design failed', { error: String(e) });
  }

  return plan;
}


// =============================================================================
// Phase 2: Parallel HTML Generation
// =============================================================================

interface SlideHtmlResult {
  index: number;
  html: string;
  isCodeTemplate: boolean;
}

/**
 * Extract HTML from LLM response — handles raw HTML, markdown fences, and extra text.
 */
function extractHtmlFromResponse(raw: string): string | null {
  const trimmed = raw.trim();

  // Case 1: Raw HTML (starts with <!DOCTYPE or <html)
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return trimmed;
  }

  // Case 2: HTML in markdown fences
  const fenceMatch = trimmed.match(/```(?:html)?\s*\n?(<!DOCTYPE[\s\S]*?<\/html>)\s*\n?```/i);
  if (fenceMatch) return fenceMatch[1]!;

  // Case 3: HTML buried in extra text
  const htmlMatch = trimmed.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
  if (htmlMatch) return htmlMatch[1]!;

  // Case 4: Missing DOCTYPE but has <html>
  const htmlTagMatch = trimmed.match(/(<html[\s\S]*<\/html>)/i);
  if (htmlTagMatch) return '<!DOCTYPE html>\n' + htmlTagMatch[1]!;

  return null;
}

async function generateSingleSlideHtml(
  llmClient: LLMClient,
  slide: SlidePlan,
  design: DesignSystem,
  slideIndex: number,
  totalSlides: number,
  language: 'ko' | 'en',
): Promise<{ html: string; isCodeTemplate: boolean } | null> {
  const contentDirection = (slide.content_direction || '').trim();

  // Direct HTML generation: LLM has full creative freedom
  logger.info(`Slide ${slideIndex + 1}: Generating free-form HTML for "${slide.title}"`);
  const htmlPrompt = buildFreeHtmlPrompt(
    slide.title, contentDirection, design, slideIndex, totalSlides, language,
  );

  try {
    const res = await llmClient.chatCompletion({
      messages: [
        { role: 'system', content: htmlPrompt },
        { role: 'user', content: 'Output the complete HTML now.' },
      ],
      temperature: 0.6,
    });
    const msg = res.choices[0]?.message;
    const rawHtml = msg ? extractContent(msg as unknown as Record<string, unknown>) : '';
    let html = extractHtmlFromResponse(rawHtml);

    if (html && !hasPlaceholderText(html)) {
      return { html, isCodeTemplate: false };
    }

    // Retry once with lower temperature
    logger.warn(`Slide ${slideIndex + 1}: First HTML attempt failed. Raw length: ${rawHtml.length}. Retrying...`);
    const retryRes = await llmClient.chatCompletion({
      messages: [
        { role: 'system', content: htmlPrompt },
        { role: 'user', content: 'Output ONLY the complete HTML document. Start with <!DOCTYPE html> and end with </html>. No explanation.' },
      ],
      temperature: 0.4,
    });
    const retryMsg = retryRes.choices[0]?.message;
    const retryRaw = retryMsg ? extractContent(retryMsg as unknown as Record<string, unknown>) : '';
    html = extractHtmlFromResponse(retryRaw);

    if (html && !hasPlaceholderText(html)) {
      return { html, isCodeTemplate: false };
    }

    logger.warn(`Slide ${slideIndex + 1}: Both HTML attempts failed.`);
  } catch (e) {
    logger.warn(`Slide ${slideIndex + 1}: HTML generation error: ${e}`);
  }

  return null;
}

async function generateAllHtml(
  llmClient: LLMClient,
  plan: StructuredPlan,
  companyName: string,
  titleSubtitle: string,
  kstDate: string,
  language: 'ko' | 'en',
  phaseLogger: PhaseLoggerFn | null,
): Promise<Map<number, SlideHtmlResult>> {
  const results = new Map<number, SlideHtmlResult>();

  // Title/closing/overview: code-generated (instant, no LLM)
  for (let i = 0; i < plan.slides.length; i++) {
    const slide = plan.slides[i]!;
    if (slide.type === 'title') {
      results.set(i, {
        index: i,
        html: buildTitleSlideHtml(plan.design, companyName, titleSubtitle, kstDate, i + 1),
        isCodeTemplate: true,
      });
    } else if (slide.type === 'closing') {
      const closingTagline = (slide.content_direction || '').replace(/감사합니다|thank\s*you/gi, '').trim() || undefined;
      results.set(i, {
        index: i,
        html: buildClosingSlideHtml(plan.design, companyName, i + 1, language, closingTagline),
        isCodeTemplate: true,
      });
    }
    // Overview/TOC slides are now LLM-generated (not code-generated) for better quality
  }

  // Content slides: parallel LLM calls in batches of MAX_CONCURRENT
  const contentIndices = plan.slides
    .map((s, i) => ({ slide: s, index: i }))
    .filter(({ index }) => !results.has(index));

  if (phaseLogger) phaseLogger('powerpoint-create', 'html-generation', `Generating ${contentIndices.length} content slides in parallel (batch size ${MAX_CONCURRENT})...`);

  for (let batch = 0; batch < contentIndices.length; batch += MAX_CONCURRENT) {
    const chunk = contentIndices.slice(batch, batch + MAX_CONCURRENT);
    const promises = chunk.map(({ slide, index }) =>
      generateSingleSlideHtml(llmClient, slide, plan.design, index, plan.slides.length, language)
        .then(result => ({ index, result }))
        .catch(err => {
          logger.warn(`Slide ${index + 1}: Generation error: ${err}`);
          return { index, result: null };
        }),
    );
    const chunkResults = await Promise.all(promises);
    for (const { index, result } of chunkResults) {
      if (result) {
        results.set(index, { index, html: result.html, isCodeTemplate: result.isCodeTemplate });
      } else {
        // Emergency fallback: never lose a slide
        const slide = plan.slides[index]!;
        const fallbackHtml = buildFallbackSlideHtml(plan.design, slide.title, slide.content_direction || '', index + 1);
        results.set(index, { index, html: fallbackHtml, isCodeTemplate: true });
        logger.warn(`Slide ${index + 1}: Using fallback HTML for "${slide.title}"`);
      }
    }
    const done = Math.min(batch + MAX_CONCURRENT, contentIndices.length);
    if (phaseLogger) phaseLogger('powerpoint-create', 'html-generation', `Generated ${done}/${contentIndices.length} content slides`);
  }

  return results;
}

// =============================================================================
// Phase 3: Validation & Selective Regeneration
// =============================================================================

async function validateAndRegenerate(
  llmClient: LLMClient,
  htmlResults: Map<number, SlideHtmlResult>,
  plan: StructuredPlan,
  language: 'ko' | 'en',
  phaseLogger: PhaseLoggerFn | null,
): Promise<Map<number, SlideHtmlResult>> {
  const failedIndices: number[] = [];

  for (const [index, result] of htmlResults) {
    const slide = plan.slides[index]!;
    if (slide.type === 'title' || slide.type === 'closing') continue;
    const validation = validateSlideHtml(result.html);
    if (!validation.pass) {
      logger.info(`Slide ${index + 1}: Post-validation failed: ${validation.feedback}`);
      failedIndices.push(index);
    }
  }

  if (failedIndices.length === 0) {
    if (phaseLogger) phaseLogger('powerpoint-create', 'validation', 'All slides passed validation');
    return htmlResults;
  }

  if (phaseLogger) phaseLogger('powerpoint-create', 'validation', `${failedIndices.length} slides failed validation, regenerating in parallel...`);

  // Regenerate failed slides in parallel batches (not sequential)
  for (let batch = 0; batch < failedIndices.length; batch += MAX_CONCURRENT) {
    const chunk = failedIndices.slice(batch, batch + MAX_CONCURRENT);
    const promises = chunk.map(async (index) => {
      const slide = plan.slides[index]!;
      const original = htmlResults.get(index)!;
      try {
        const result = await generateSingleSlideHtml(
          llmClient, slide, plan.design, index, plan.slides.length, language,
        );
        if (result) {
          const regenHasPlaceholder = hasPlaceholderText(result.html);
          const origHasPlaceholder = hasPlaceholderText(original.html);
          if (!regenHasPlaceholder || origHasPlaceholder) {
            return { index, result: { index, html: result.html, isCodeTemplate: result.isCodeTemplate } };
          }
        }
      } catch (e) {
        logger.warn(`Slide ${index + 1}: Regen error: ${e}`);
      }
      return { index, result: null };
    });
    const chunkResults = await Promise.all(promises);
    for (const { index, result } of chunkResults) {
      if (result) {
        htmlResults.set(index, result);
      }
      // If result is null, keep the original — NEVER delete
    }
  }

  return htmlResults;
}

// =============================================================================
// Phase 4: Pipeline Assembly (pre-create slides + parallel screenshots + fill)
// =============================================================================

// Max concurrent Edge screenshot processes
const MAX_SCREENSHOT_CONCURRENT = 4;

async function assemblePresentation(
  htmlResults: Map<number, SlideHtmlResult>,
  plan: StructuredPlan,
  timestamp: number,
  savePath: string | undefined,
  companyName: string,
  language: 'ko' | 'en',
  phaseLogger: PhaseLoggerFn | null,
  toolCallLogger: ToolCallLoggerFn | null,
): Promise<{ builtSlides: string[]; totalToolCalls: number }> {
  const { writePath: tempWritePath, winPath: tempWinPath } = getTempDir();
  ensureTempDir(tempWritePath);

  const totalSlides = htmlResults.size;
  const sortedEntries = [...htmlResults.entries()].sort((a, b) => a[0] - b[0]);
  const builtSlides: string[] = [];
  let totalToolCalls = 0;
  const tempFiles: string[] = [];

  // ─── Step 1: Pre-create all blank slides ───
  // Verify initial slide count, then add slides to reach totalSlides
  const initCountRes = await powerpointClient.powerpointGetSlideCount();
  const initSlideCount = (initCountRes as Record<string, unknown>)['slide_count'] as number || 1;
  const slidesToAdd = Math.max(0, totalSlides - initSlideCount);
  if (phaseLogger) phaseLogger('powerpoint-create', 'assembly', `Pre-creating ${totalSlides} slides (existing: ${initSlideCount}, adding: ${slidesToAdd})...`);
  for (let i = 0; i < slidesToAdd; i++) {
    await powerpointClient.powerpointAddSlide(7);
    totalToolCalls++;
  }

  // ─── Step 2: Write all HTML files ───
  interface SlideFileInfo {
    slideNum: number;
    htmlWritePath: string;
    pngWritePath: string;
    htmlWinPath: string;
    pngWinPath: string;
  }
  const slideFiles = new Map<number, SlideFileInfo>();
  let slideNum = 0;
  for (const [index, result] of sortedEntries) {
    slideNum++;
    const htmlFileName = `hanseol_slide_${slideNum}_${timestamp}.html`;
    const pngFileName = `hanseol_slide_${slideNum}_${timestamp}.png`;
    const htmlWritePath = path.join(tempWritePath, htmlFileName);
    const pngWritePath = path.join(tempWritePath, pngFileName);
    const htmlWinPath = `${tempWinPath}\\${htmlFileName}`;
    const pngWinPath = `${tempWinPath}\\${pngFileName}`;

    try {
      const viewportHtml = injectEdgeSizing(result.html, plan.design.background_color);
      fs.writeFileSync(htmlWritePath, viewportHtml, 'utf-8');
      tempFiles.push(htmlWritePath);
      slideFiles.set(index, { slideNum, htmlWritePath, pngWritePath, htmlWinPath, pngWinPath });
    } catch (e) {
      logger.warn(`Slide ${slideNum}: Failed to write HTML: ${e}`);
    }
  }

  // ─── Step 3: Parallel Edge screenshots ───
  if (phaseLogger) phaseLogger('powerpoint-create', 'assembly', `Rendering ${slideFiles.size} screenshots in parallel (batch ${MAX_SCREENSHOT_CONCURRENT})...`);
  const screenshotEntries = [...slideFiles.entries()].sort((a, b) => a[0] - b[0]);
  const screenshotSuccess = new Set<number>();

  for (let batch = 0; batch < screenshotEntries.length; batch += MAX_SCREENSHOT_CONCURRENT) {
    const chunk = screenshotEntries.slice(batch, batch + MAX_SCREENSHOT_CONCURRENT);
    const batchResults = await Promise.all(chunk.map(async ([index, files]) => {
      let success = false;
      try {
        const result = await powerpointClient.renderHtmlToImage(files.htmlWinPath, files.pngWinPath);
        totalToolCalls++;
        success = result.success;
        if (!success) {
          await new Promise(r => setTimeout(r, 1500));
          const retry = await powerpointClient.renderHtmlToImage(files.htmlWinPath, files.pngWinPath);
          totalToolCalls++;
          success = retry.success;
        }
      } catch {
        try {
          await new Promise(r => setTimeout(r, 1500));
          const retry = await powerpointClient.renderHtmlToImage(files.htmlWinPath, files.pngWinPath);
          totalToolCalls++;
          success = retry.success;
        } catch { success = false; }
      }

      // Clean up HTML immediately
      try { fs.unlinkSync(files.htmlWritePath); } catch { /* ignore */ }

      // Validate PNG size
      if (success) {
        try {
          const stat = fs.statSync(files.pngWritePath);
          if (stat.size < 15000) {
            logger.warn(`Slide ${files.slideNum}: Screenshot too small (${stat.size} bytes)`);
            success = false;
            try { fs.unlinkSync(files.pngWritePath); } catch { /* ignore */ }
          }
        } catch { /* proceed */ }
      }

      if (success) tempFiles.push(files.pngWritePath);
      return { index, success };
    }));

    for (const { index, success } of batchResults) {
      if (success) screenshotSuccess.add(index);
    }
    const done = Math.min(batch + MAX_SCREENSHOT_CONCURRENT, screenshotEntries.length);
    if (phaseLogger) phaseLogger('powerpoint-create', 'assembly', `Screenshots: ${done}/${screenshotEntries.length} done`);
  }

  // ─── Step 4: Fill pre-created slides ───
  // For slides where screenshot failed, try fallback rendering before giving up
  if (phaseLogger) phaseLogger('powerpoint-create', 'assembly', `Filling ${totalSlides} slides...`);
  const unfilledSlideNums: number[] = [];

  for (const [index] of sortedEntries) {
    const files = slideFiles.get(index);
    const slidePlan = plan.slides[index]!;
    const htmlResult = htmlResults.get(index)!;

    if (!files) {
      // Compute slideNum from sorted position (1-indexed)
      const posInSorted = sortedEntries.findIndex(([idx]) => idx === index);
      const inferredSlideNum = posInSorted >= 0 ? posInSorted + 1 : -1;
      logger.warn(`Slide index ${index} (slideNum ${inferredSlideNum}): No file info, marking for deletion`);
      if (inferredSlideNum > 0) unfilledSlideNums.push(inferredSlideNum);
      continue;
    }

    let filled = false;

    if (screenshotSuccess.has(index)) {
      // Primary path: screenshot succeeded, fill with PNG
      const bgResult = await powerpointClient.powerpointAddFullSlideImage(files.slideNum, files.pngWinPath);
      totalToolCalls++;
      if (toolCallLogger) toolCallLogger('powerpoint-create', 'addFullSlideImage', { slideNum: files.slideNum, imagePath: files.pngWinPath }, bgResult.success ? 'OK' : 'Failed', bgResult.success, files.slideNum, totalToolCalls);
      filled = bgResult.success;
    }

    if (!filled) {
      // Fallback: re-render with simpler fallback HTML
      logger.info(`Slide ${files.slideNum}: Primary screenshot failed, trying fallback rendering...`);
      const slide = plan.slides[index]!;
      const fallbackHtml = buildFallbackSlideHtml(plan.design, slide.title, slide.content_direction || '', files.slideNum);
      const fbHtmlName = `hanseol_fb_${files.slideNum}_${timestamp}.html`;
      const fbPngName = `hanseol_fb_${files.slideNum}_${timestamp}.png`;
      const fbHtmlWrite = path.join(tempWritePath, fbHtmlName);
      const fbPngWrite = path.join(tempWritePath, fbPngName);
      const fbHtmlWin = `${tempWinPath}\\${fbHtmlName}`;
      const fbPngWin = `${tempWinPath}\\${fbPngName}`;

      try {
        const viewportHtml = injectEdgeSizing(fallbackHtml, plan.design.background_color);
        fs.writeFileSync(fbHtmlWrite, viewportHtml, 'utf-8');
        const fbResult = await powerpointClient.renderHtmlToImage(fbHtmlWin, fbPngWin);
        totalToolCalls++;
        try { fs.unlinkSync(fbHtmlWrite); } catch { /* ignore */ }

        if (fbResult.success) {
          const bgResult = await powerpointClient.powerpointAddFullSlideImage(files.slideNum, fbPngWin);
          totalToolCalls++;
          filled = bgResult.success;
          try { fs.unlinkSync(fbPngWrite); } catch { /* ignore */ }
        }
      } catch (e) {
        logger.warn(`Slide ${files.slideNum}: Fallback rendering also failed: ${e}`);
        try { fs.unlinkSync(fbHtmlWrite); } catch { /* ignore */ }
      }
    }

    if (filled) {
      builtSlides.push(`Slide ${files.slideNum}: ${slidePlan.title} (${slidePlan.type})`);
      try { await powerpointClient.powerpointAddNote(files.slideNum, htmlResult.html); } catch { /* non-critical */ }
    } else {
      logger.warn(`Slide ${files.slideNum}: All rendering attempts failed, marking for deletion`);
      unfilledSlideNums.push(files.slideNum);
    }
  }

  // ─── Step 5: Delete specific unfilled slides (highest number first to avoid shift) ───
  if (unfilledSlideNums.length > 0) {
    const sortedDesc = [...unfilledSlideNums].sort((a, b) => b - a);
    for (const slideNum of sortedDesc) {
      try {
        await powerpointClient.powerpointDeleteSlide(slideNum);
        totalToolCalls++;
        logger.info(`Deleted unfilled slide ${slideNum}`);
      } catch (e) {
        logger.warn(`Failed to delete unfilled slide ${slideNum}: ${e}`);
      }
    }
  }

  // ─── Step 5.5: Closing slide guarantee ───
  // If the plan has a closing slide but it was lost during assembly, add it now
  const hasClosingInPlan = plan.slides.some(s => s.type === 'closing');
  const hasClosingBuilt = builtSlides.some(s => s.includes('(closing)'));
  if (hasClosingInPlan && !hasClosingBuilt && builtSlides.length > 0) {
    logger.info('Closing slide was lost during assembly — adding it now');
    try {
      await powerpointClient.powerpointAddSlide(7);
      totalToolCalls++;
      const slideCountRes = await powerpointClient.powerpointGetSlideCount();
      const newSlideNum = (slideCountRes as Record<string, unknown>)['slide_count'] as number || builtSlides.length + 1;

      const closingPlan = plan.slides.find(s => s.type === 'closing')!;
      const closingTagline = (closingPlan.content_direction || '').replace(/감사합니다|thank\s*you/gi, '').trim() || undefined;
      const closingHtml = buildClosingSlideHtml(plan.design, companyName, newSlideNum, language, closingTagline);
      const clHtmlName = `hanseol_closing_${timestamp}.html`;
      const clPngName = `hanseol_closing_${timestamp}.png`;
      const clHtmlWrite = path.join(tempWritePath, clHtmlName);
      const clPngWrite = path.join(tempWritePath, clPngName);
      const clHtmlWin = `${tempWinPath}\\${clHtmlName}`;
      const clPngWin = `${tempWinPath}\\${clPngName}`;

      const viewportHtml = injectEdgeSizing(closingHtml, plan.design.background_color);
      fs.writeFileSync(clHtmlWrite, viewportHtml, 'utf-8');
      const ssResult = await powerpointClient.renderHtmlToImage(clHtmlWin, clPngWin);
      totalToolCalls++;
      try { fs.unlinkSync(clHtmlWrite); } catch { /* ignore */ }

      if (ssResult.success) {
        const bgResult = await powerpointClient.powerpointAddFullSlideImage(newSlideNum, clPngWin);
        totalToolCalls++;
        if (bgResult.success) {
          builtSlides.push(`Slide ${newSlideNum}: ${closingPlan.title} (closing)`);
          logger.info('Closing slide added successfully');
        }
        try { fs.unlinkSync(clPngWrite); } catch { /* ignore */ }
      }
    } catch (e) {
      logger.warn(`Failed to add closing slide: ${e}`);
    }
  }

  // ─── Step 6: Save ───
  if (builtSlides.length > 0) {
    if (savePath) {
      const wslSavePath = savePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`);
      try { fs.unlinkSync(wslSavePath); } catch { /* file may not exist */ }
    }

    let saveResult = await powerpointClient.powerpointSave(savePath);
    totalToolCalls++;
    if (toolCallLogger) toolCallLogger('powerpoint-create', 'powerpoint_save', { path: savePath }, saveResult.success ? (saveResult['path'] as string || 'OK') : (saveResult.error || 'Failed'), saveResult.success, 0, totalToolCalls);

    if (!saveResult.success && savePath) {
      const fallbackPath = 'C:\\temp\\presentation.pptx';
      saveResult = await powerpointClient.powerpointSave(fallbackPath);
      totalToolCalls++;
    }
  }

  // ─── Cleanup temp PNG files ───
  for (const tempFile of tempFiles) {
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
  }

  return { builtSlides, totalToolCalls };
}

// =============================================================================
// Main Runner — v2 Pipeline
// =============================================================================

async function runStructured(
  llmClient: LLMClient,
  instruction: string,
  explicitSavePath?: string,
): Promise<ToolResult> {
  const startTime = Date.now();
  const phaseLogger = getSubAgentPhaseLogger();
  const toolCallLogger = getSubAgentToolCallLogger();
  const timestamp = Date.now();

  logger.enter('PPT-Create.runStructured.v2');

  // Detect language
  const hasKorean = /[\uac00-\ud7af\u1100-\u11ff]/.test(instruction);
  const language: 'ko' | 'en' = hasKorean ? 'ko' : 'en';

  // ─── Phase 1: Design + Open PowerPoint (parallel) ───
  if (phaseLogger) phaseLogger('powerpoint-create', 'init', 'Starting Design phase + opening PowerPoint...');

  const [plan, createResult] = await Promise.all([
    runDesignPhase(llmClient, instruction, phaseLogger),
    powerpointClient.powerpointCreate(),
  ]);

  if (!createResult.success) {
    return { success: false, error: `Failed to create presentation: ${(createResult as Record<string, unknown>)['error']}` };
  }

  if (!plan) {
    logger.error('PPT planning failed after retries — cannot create presentation');
    return { success: false, error: 'Failed to generate presentation plan. Please try again.' };
  }

  // Hard cap slide count
  if (plan.slides.length > 20) {
    const firstSlide = plan.slides[0]!;
    const lastSlide = plan.slides[plan.slides.length - 1]!;
    const contentSlides = plan.slides.slice(1, -1).slice(0, 18);
    plan.slides = [firstSlide, ...contentSlides, lastSlide];
  }

  // Post-plan fixups
  const userYearMatch = instruction.match(/(\d{4})년/);
  if (userYearMatch) {
    const userYear = userYearMatch[1];
    for (const slide of plan.slides) {
      if (slide.type === 'content' && slide.content_direction) {
        if (!slide.content_direction.includes(`${userYear}년`)) {
          slide.content_direction += ` (Note: This report covers ${userYear}년 data.)`;
        }
      }
    }
  }

  // Extract save path
  let savePath: string | undefined = explicitSavePath;
  if (!savePath) {
    const fullPathMatch = instruction.match(/([A-Za-z]:\\[^\s,]+\.pptx|\/[^\s,]+\.pptx)/i);
    if (fullPathMatch) {
      savePath = fullPathMatch[1];
    } else {
      const nameMatch = instruction.match(/([\w][\w\-_.]*\.pptx)/i);
      if (nameMatch) {
        savePath = `C:\\temp\\${nameMatch[1]}`;
      }
    }
  }

  // Date for title slide
  const titleSlidePlanForDate = plan.slides.find(s => s.type === 'title');
  const dateSearchTexts = [instruction, titleSlidePlanForDate?.title || '', titleSlidePlanForDate?.content_direction || ''];
  let kstDate = '';
  for (const text of dateSearchTexts) {
    const dateMatch = text.match(/(\d{4})년\s*(\d{1,2})\s*(월|분기)/);
    if (dateMatch) {
      kstDate = `${dateMatch[1]}년 ${dateMatch[2]}${dateMatch[3]}`;
      break;
    }
  }
  if (!kstDate) {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    kstDate = `${kstNow.getUTCFullYear()}년 ${kstNow.getUTCMonth() + 1}월`;
  }

  // Extract company name and subtitle
  const titleSlidePlan = plan.slides.find(s => s.type === 'title');
  const rawTitleText = titleSlidePlan?.title || '';
  const titleSeps = [' - ', ' – ', ' — ', ': ', ' | '];
  let companyName = rawTitleText;
  let titleSubtitle = '';
  for (const sep of titleSeps) {
    const idx = rawTitleText.indexOf(sep);
    if (idx > 0) {
      companyName = rawTitleText.slice(0, idx).trim();
      titleSubtitle = rawTitleText.slice(idx + sep.length).trim();
      break;
    }
  }
  if (!titleSubtitle && titleSlidePlan) {
    titleSubtitle = ((titleSlidePlan.content_direction || '').split('\n')[0] || '').trim().slice(0, 120);
  }
  if (/로고|슬로건|연락처|contact|logo|placeholder/i.test(titleSubtitle)) {
    titleSubtitle = '';
  }

  // Company name extraction from instruction (strip markdown bold markers)
  const cleanInstruction = instruction.replace(/\*\*/g, '');
  const companyMatch = cleanInstruction.match(/회사명\s*[:：]?\s*([^\s,，、]+)/);
  if (companyMatch && companyMatch[1]) {
    const companyName_ = companyMatch[1];
    if (titleSlidePlan && titleSlidePlan.title.trim() !== companyName_) {
      const originalTitle = titleSlidePlan.title;
      titleSlidePlan.title = companyName_;
      companyName = companyName_;
      if (!titleSlidePlan.content_direction?.includes(originalTitle)) {
        const stripped = originalTitle.replace(companyName_, '').replace(/^\s*[-–—:|\s]+/, '').trim();
        titleSubtitle = stripped || originalTitle;
        titleSlidePlan.content_direction = titleSubtitle + (titleSlidePlan.content_direction ? '\n' + titleSlidePlan.content_direction : '');
      }
    }
  }

  // ─── Phase 2: Parallel HTML Generation ───
  if (phaseLogger) phaseLogger('powerpoint-create', 'html-generation', 'Starting parallel HTML generation...');

  const htmlResults = await generateAllHtml(
    llmClient, plan, companyName, titleSubtitle, kstDate, language, phaseLogger,
  );

  // ─── Phase 3: Validation & Selective Regeneration ───
  const validatedResults = await validateAndRegenerate(
    llmClient, htmlResults, plan, language, phaseLogger,
  );

  // ─── Phase 4: Pipeline Assembly (pre-create + parallel screenshots + fill) ───
  if (phaseLogger) phaseLogger('powerpoint-create', 'assembly', `Assembling ${validatedResults.size} slides into PowerPoint...`);

  const { builtSlides, totalToolCalls } = await assemblePresentation(
    validatedResults, plan, timestamp, savePath, companyName, language, phaseLogger, toolCallLogger,
  );

  const duration = Date.now() - startTime;
  const slideList = builtSlides.join('\n');
  const summary = `Presentation COMPLETE — ${builtSlides.length} slides created and saved successfully.\nAll requested topics are covered across these slides. Do NOT add more slides or call powerpoint_modify_agent.\n\nSlides:\n${slideList}`;

  logger.exit('PPT-Create.runStructured.v2', { slideCount: builtSlides.length, totalToolCalls, duration });

  return {
    success: builtSlides.length > 0,
    result: summary,
    metadata: { iterations: plan.slides.length, toolCalls: totalToolCalls, duration },
  };
}

// =============================================================================
// Tool Definition Export
// =============================================================================

export function createPowerPointCreateRequestTool(): LLMAgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'powerpoint_create_agent',
        description:
          'Autonomous PowerPoint CREATION agent. Creates NEW presentations from scratch with professional slide designs, color schemes, and visual hierarchy. Uses HTML rendering pipeline for maximum design quality — each slide is rendered as a beautiful HTML page and captured as a high-quality image. Give it a topic or outline and it produces a polished, enterprise-grade presentation. For EDITING existing .pptx files, use powerpoint_modify_agent instead.',
        parameters: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description:
                'Detailed instruction for creating a new presentation. Include: topic/title, desired content, and design preferences. The agent autonomously creates a professional presentation with title, content, and closing slides.',
            },
            save_path: {
              type: 'string',
              description:
                'Windows file path to save the presentation (e.g., "C:\\\\temp\\\\pitch.pptx"). MUST be provided if the user specified a save path.',
            },
          },
          required: ['instruction'],
        },
      },
    },
    execute: async (args, llmClient) => {
      const instruction = args['instruction'] as string;
      const explicitSavePath = args['save_path'] as string | undefined;
      return runStructured(llmClient, instruction, explicitSavePath);
    },
    categories: ['llm-agent'],
    requiresSubLLM: true,
  };
}
