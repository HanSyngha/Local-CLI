/**
 * PowerPoint Creation Agent Prompts — HTML Rendering Pipeline
 *
 * Single Design Prompt → JSON { design, slides }
 * Per-slide: Direct HTML generation or Code-template fallback
 *
 * * * * Electron parity: src/agents/office/powerpoint-create-prompts.ts
 */

// =============================================================================
// 1. PPT_DESIGN_PROMPT — Merged Enhancement + Planning (single LLM call)
// =============================================================================

export const PPT_DESIGN_PROMPT = `You are an elite presentation design consultant AND structure planner. Output ONLY valid JSON — no markdown, no explanation, no code fences.

Given the user's instruction, produce a JSON object with a visual design system and a detailed slide plan.

{
  "design": {
    "primary_color": "<deep color matching the topic>",
    "accent_color": "<vibrant contrast color>",
    "background_color": "<near-white or near-black or subtle tint>",
    "text_color": "<must contrast with background>",
    "accent_light": "<light tint of your accent color>",
    "gradient_end": "<secondary gradient paired with primary>",
    "font_title": "Segoe UI",
    "font_body": "Malgun Gothic",
    "mood": "modern-minimal",
    "design_notes": "Describe your visual approach in 1-2 sentences"
  },
  "slides": [
    { "type": "title", "title": "...", "content_direction": "..." },
    { "type": "content", "title": "...", "content_direction": "..." },
    { "type": "closing", "title": "...", "content_direction": "..." }
  ]
}

═══ DESIGN SYSTEM ═══
• primary_color: Deep main color for headers and key elements
• accent_color: Vibrant contrast color for highlights and CTAs
• background_color: Page background (near white, near black, or subtle tint)
• text_color: Main text color (must contrast with background)
• accent_light: Light tint for subtle section backgrounds
• gradient_end: Paired gradient color for primary
• font_title / font_body: System fonts only (Segoe UI, Arial, Georgia, Calibri, Malgun Gothic)
• mood: One of modern-minimal, bold-energetic, corporate-elegant, warm-friendly, academic-clean

═══ COLOR PALETTE — CREATIVE PSYCHOLOGY ═══
⚠ EVERY presentation must have a UNIQUE palette matching the topic's emotional tone.
  Think about color psychology: trust (blues), growth (greens), urgency (reds/oranges),
  innovation (purples/cyans), warmth (corals/browns), elegance (charcoals/rose), wealth (navy/gold).
  Pick DEEP saturated colors for primary, VIBRANT contrasting for accent.
⚠ Choose colors that MATCH the specific topic. Generic blue = LAZY.
⚠ Ensure accent_color has HIGH contrast with primary_color.

═══ SLIDE STRUCTURE ═══
⚠ USER SLIDE COUNT OVERRIDE:
  • 1 slide: ALL content on one slide. Type="content". No title slide, no closing.
  • 2 slides: Two content slides. No title, no closing. Every slide is type="content".
  • 3 slides: Three content slides. No title, no closing. Every slide is type="content". Pack each with rich visual content (cards, metrics, process flows).
  • 4-5 slides: title (1) + content (N-2) + closing (1).
  • 6+ slides with user count: title (1) + content (N-2) + closing (1). Match exact count.
⚠ Default (no user count): First slide MUST be type "title". Last slide MUST be type "closing". Minimum 10, maximum 13 slides total. Aim for 10-12.
⚠ Current year: \${new Date().getFullYear()}.

═══ TITLE & CLOSING FORMAT ═══
⚠ Title slide:
  • title: Company/topic name ONLY — max 3-4 words (rendered at 96px)
    ✓ "Acme Corp"  ✓ " "  ✗ "Acme Corp - 2025   " (too long)
  • content_direction: The actual subtitle/tagline TEXT (1-2 lines, under 120 chars)
⚠ Closing slide:
  • title: "" (Korean) / "Thank You" (English)
  • content_direction: Company/topic name

═══ SLIDE STRUCTURE STRATEGY ═══
⚠ Do NOT follow a fixed template. Instead, analyze the user's topic and determine the most logical slide flow yourself.
⚠ Think about what information the audience NEEDS and in what ORDER.
⚠ General principles:
  - Start with context/background before diving into details
  - Build a narrative arc: setup → evidence → insight → action
  - Each slide should have a DISTINCT purpose — no redundant slides
  - End with actionable conclusions or key takeaways before closing
⚠ The slide structure should feel CUSTOM-TAILORED to the specific topic, not a generic template.

═══ content_direction = THE #1 PRIORITY ═══
⚠⚠⚠ content_direction is the REAL DATA AND TEXT that will appear on the slide.
⚠ Each content_direction MUST be 6-10 sentences of SPECIFIC DATA:
  - Include: numbers, percentages, names, descriptions, dates, comparisons
  - The MORE specific data you provide, the better the slide will look
  - Each item/section: title + 3-4 supporting details with real numbers
⚠ content_direction MUST describe ONE focused topic per slide.
  If a topic has 4+ sub-items, SPLIT into 2 slides.
⚠ NEVER include layout/CSS instructions in content_direction. Just the DATA.
  ✓ GOOD: "2024    4.8 won.   23% .   :    35% ,    89%,     41%. 2027   7.2 won."
  ✓ GOOD: "  A: monthly subscription service. basic plan monthly 29won, pro plan monthly 59won, enterprise custom quote. key features:   dashboard, automated report generation, API integration. adopting companies 120companies, average customer satisfaction 94.2%."
  ✗ BAD: "3  . Layout: cards" ← Too sparse, has layout hint!
  ✗ BAD: " ,  " ← Layout instruction!

═══ SLIDE CONTENT VARIETY ═══
⚠ Each slide's content should naturally suggest a DIFFERENT visual treatment.
  Vary what you write about across slides:
  - Some slides: key metrics/numbers (naturally displayed as large metric spotlights)
  - Some slides: comparison data (naturally shown as tables or side-by-side)
  - Some slides: step-by-step processes (naturally shown as flows)
  - Some slides: category breakdowns (naturally shown as charts or card grids)
  - Some slides: timeline/roadmap items (naturally shown as milestone sequences)
  - Some slides: detailed feature descriptions (naturally shown as rich cards)
⚠ Don't make every slide a list of items. Mix data-heavy slides with narrative slides.
⚠ AVOID having 3+ consecutive slides with the same content structure (e.g., all lists of 3-4 items).

═══ OVERVIEW / AGENDA SLIDES ═══
⚠ AVOID overview/agenda/TOC slides — they waste space and add no real content.
  Instead, jump straight into substantive content after the title slide.
  If absolutely needed: MAXIMUM 5 items with short titles only.

═══ HARD RULES ═══
⚠ ALL titles and content_direction MUST be in the SAME language as the user's instruction
⚠ content_direction with NO real data = FAILURE
⚠ HARD MAXIMUM: 13 slides. Slides beyond 13 are DISCARDED.
⚠ NEVER use "", "screenshot", "", "", "placeholder" in content_direction
⚠ Do NOT create a separate "" slide — closing handles this.

Output ONLY the JSON object.`;

// =============================================================================
// 2. DesignSystem Interface
// =============================================================================

export interface DesignSystem {
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  accent_light: string;
  gradient_end: string;
  font_title: string;
  font_body: string;
  mood: string;
  design_notes: string;
}

// =============================================================================
// 3. Layout Type System
// =============================================================================

export type LayoutType = 'cards' | 'table' | 'timeline' | 'two_col_split' | 'big_numbers' | 'bar_chart' | 'donut_chart' | 'process_flow' | 'progress_bars' | 'hero_stat';

// =============================================================================
// 4. extractLayoutHint()
// =============================================================================

/**
 * Extract layout hint from content_direction.
 * Returns a normalized LayoutType for the layout-specific prompt system.
 */
export function extractLayoutHint(contentDirection: string): LayoutType {
  const match = contentDirection.match(/Layout:\s*(.+?)$/im);
  if (!match) return 'cards';
  const hint = match[1]!.trim().toLowerCase();

  if (/card|grid/.test(hint)) return 'cards';
  if (/bar\s*chart/.test(hint)) return 'bar_chart';
  if (/donut|pie/.test(hint)) return 'donut_chart';
  if (/comparison\s*table|table/.test(hint)) return 'table';
  if (/process|flow/.test(hint)) return 'process_flow';
  if (/big\s*num|metric/.test(hint)) return 'big_numbers';
  if (/split|2-col|two.col/.test(hint)) return 'two_col_split';
  if (/timeline|milestone|roadmap/.test(hint)) return 'timeline';
  if (/progress\s*bar/.test(hint)) return 'progress_bars';
  if (/hero|spotlight/.test(hint)) return 'hero_stat';
  return 'cards';
}

// =============================================================================
// 5. checkLayoutCompliance()
// =============================================================================

/**
 * Regex-based layout compliance check. Fast and free (no LLM call).
 * Returns null if compliant, or a feedback string if the layout is wrong.
 */
export function checkLayoutCompliance(html: string, layoutType: LayoutType): string | null {
  switch (layoutType) {
    case 'donut_chart':
      if (!html.includes('conic-gradient')) {
        return 'WRONG LAYOUT: Expected donut/pie chart with conic-gradient. You MUST use conic-gradient on a border-radius:50% div. Copy the REQUIRED HTML structure from the prompt.';
      }
      break;
    case 'bar_chart': {
      const hasFlexEnd = /flex-end/.test(html);
      const barHeights = html.match(/style="[^"]*height:\s*\d+%/g) || [];
      if (!hasFlexEnd || barHeights.length < 2) {
        return `WRONG LAYOUT: Expected CSS bar chart with flex-end + at least 2 bars with height:XX%. Found flex-end:${hasFlexEnd}, bars:${barHeights.length}. Copy the REQUIRED HTML structure with .chart-area, .bar-group, .bar elements.`;
      }
      break;
    }
    case 'table':
      if (!html.includes('<table') || !html.includes('<th')) {
        return 'WRONG LAYOUT: Expected HTML <table> with <th> header cells. Copy the REQUIRED HTML structure.';
      }
      break;
    case 'process_flow': {
      const arrowCount = (html.match(/→/g) || []).length;
      const hasSteps = /class="[^"]*step/i.test(html);
      if (arrowCount < 2 || !hasSteps) {
        return `WRONG LAYOUT: Expected process flow with step boxes and → arrows. Found arrows:${arrowCount}, steps:${hasSteps}. You MUST have .step divs connected by .arrow divs containing "→".`;
      }
      break;
    }
    case 'progress_bars': {
      const hasFill = /bar-fill/i.test(html);
      const hasTrack = /bar-track/i.test(html);
      const widthBars = html.match(/style="[^"]*width:\s*\d+%/g) || [];
      if (!hasFill || !hasTrack || widthBars.length < 2) {
        return `WRONG LAYOUT: Expected progress bars with .bar-track + .bar-fill + width:XX%. Found fill:${hasFill}, track:${hasTrack}, bars:${widthBars.length}. Copy the REQUIRED HTML structure.`;
      }
      break;
    }
    case 'timeline': {
      const hasMilestone = /class="[^"]*milestone/i.test(html);
      const milestoneCount = (html.match(/class="[^"]*milestone[^"]*"/gi) || []).length;
      if (!hasMilestone || milestoneCount < 2) {
        return `WRONG LAYOUT: Expected timeline with milestone cards. Found ${milestoneCount} milestones. You MUST have 3-4 .milestone divs side by side.`;
      }
      break;
    }
    case 'big_numbers': {
      const bigFonts = html.match(/font-size:\s*(?:7[2-9]|[89]\d|1[0-2]\d)px/g) || [];
      if (bigFonts.length < 2) {
        return `WRONG LAYOUT: Expected big number metrics with font-size 72-96px. Found ${bigFonts.length} large fonts. Each .metric-card MUST have a .metric-value with font-size:80px.`;
      }
      break;
    }
    case 'hero_stat': {
      const heroFont = html.match(/font-size:\s*(?:9[6-9]|1[0-2]\d)px/g) || [];
      if (heroFont.length < 1) {
        return `WRONG LAYOUT: Expected hero stat with font-size 96-128px. You MUST have ONE .hero-number with font-size:128px.`;
      }
      break;
    }
    // cards and two_col_split are flexible enough to not need strict checks
  }
  return null;
}

// =============================================================================
// 6. buildDirectHtmlPrompt() — NEW: Direct LLM HTML generation
// =============================================================================

/**
 * Build a prompt for DIRECT HTML generation — LLM outputs the complete slide HTML.
 * Used as the primary generation path before falling back to JSON-fill + code-template.
 */
export function buildDirectHtmlPrompt(
  title: string,
  contentDirection: string,
  design: DesignSystem,
  slideIndex: number,
  totalSlides: number,
  language: 'ko' | 'en',
  layoutType: LayoutType,
): string {
  const langRule = language === 'ko'
    ? 'ALL visible text MUST be in Korean. Write naturally in Korean. Never use Chinese characters (漢字).'
    : 'ALL visible text MUST be in English.';

  const layoutCss = getLayoutSpecificCss(layoutType, design);

  // Rotate visual variety per slide
  const styleVariants = [
    `Background: ${design.background_color}. Cards/elements use white background with box-shadow.`,
    `Add a bold accent bar at top (height:4px, linear-gradient(90deg, ${design.accent_color}, ${design.primary_color})). Background: ${design.background_color}.`,
    `Subtle gradient background: linear-gradient(150deg, ${design.background_color} 0%, ${design.accent_light} 50%, ${design.background_color} 100%). Stronger shadows.`,
  ] as const;
  const styleGuide = styleVariants[slideIndex % styleVariants.length]!;

  return `You are a world-class web designer creating a presentation slide as a complete HTML page.
Output ONLY the complete HTML document (<!DOCTYPE html> to </html>). No explanation, no markdown fences.

═══ SLIDE ═══
Title: "${title}" | Slide ${slideIndex + 1} of ${totalSlides}

═══ CONTENT (what to show — generate REAL content based on this, never display it literally) ═══
${contentDirection}

═══ DESIGN SYSTEM ═══
Primary: ${design.primary_color} | Accent: ${design.accent_color} | BG: ${design.background_color}
Text: ${design.text_color} | Light: ${design.accent_light} | Gradient: ${design.gradient_end}
Title Font: ${design.font_title} | Body Font: ${design.font_body} | Mood: ${design.mood}

═══ VISUAL STYLE FOR THIS SLIDE ═══
${styleGuide}

═══ MANDATORY CSS BOILERPLATE (copy exactly into <style>) ═══
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1920px; height:1080px; overflow:hidden; font-family:"${design.font_body}","${design.font_title}","Segoe UI","Malgun Gothic",Arial,sans-serif; word-break:keep-all; overflow-wrap:break-word; }
body { display:flex; flex-direction:column; padding:60px 80px; height:1080px; background:${design.background_color}; color:${design.text_color}; font-size:26px; }
.slide-title { flex:0 0 auto; margin-bottom:20px; }
.slide-title h1 { font-size:48px; font-weight:700; color:${design.primary_color}; font-family:"${design.font_title}","Segoe UI",sans-serif; }

═══ STRUCTURE: body has EXACTLY 2 children ═══
  → .slide-title (flex:0 0 auto) containing h1 with title text + optional accent bar
  → .content (flex:1) stretching to fill ALL remaining vertical space
⚠ .content class name is REQUIRED for post-processing.
⚠ ALL layout elements MUST be DIRECT children of .content — NO wrapper divs.
⚠ NEVER use position:absolute. Flexbox/grid ONLY.

${layoutCss}

═══ RULES ═══
• ${langRule}
• Complete HTML: <!DOCTYPE html> through </html>. ALL styling in <style>.
• NO <img>, NO external resources, NO JavaScript, NO external fonts.
• System fonts ONLY. CSS for visuals: gradients, shapes, shadows, borders.
• Title: 42-48px bold. Body: 26-32px. MINIMUM any text: 24px. If text needs to shrink below 24px, remove content instead.
• Content fills 85-95% of 1080px height. Empty space = FAILURE. MAX ~1000 chars of visible text.
• NEVER use justify-content:center on .content (creates dead space). Use stretch/space-evenly.
• Use gradients, box-shadow (0 4px 20px rgba(0,0,0,0.06)), border-radius (12-20px).
• Generate REAL professional content. No placeholders. Specific numbers and data.
• If user specified a year, USE THAT YEAR. Default to ${new Date().getFullYear()} only when no year given.
• Page number: bottom-right "${slideIndex + 1}" (12px, opacity 0.4).

Output the complete HTML now.`;
}

// =============================================================================
// 7a. buildFreeHtmlPrompt() — LLM generates complete HTML with full creative freedom
// =============================================================================

/**
 * Build prompt for FREE-FORM HTML generation.
 * The LLM has complete creative freedom to design the best visual for the content.
 * No fixed layout types — the LLM decides based on content.
 */
export function buildFreeHtmlPrompt(
  title: string,
  contentDirection: string,
  design: DesignSystem,
  slideIndex: number,
  totalSlides: number,
  language: 'ko' | 'en',
): string {
  const langRule = language === 'ko'
    ? 'ALL visible text MUST be in Korean. Write naturally in Korean. Never use Chinese characters (漢字).'
    : 'ALL visible text MUST be in English.';

  // Rotate subtle style variants for visual variety across slides
  const variants = [
    `Background: ${design.background_color}. Elements use white background with box-shadow.`,
    `Top accent bar (height:4px, linear-gradient(90deg, ${design.accent_color}, ${design.primary_color})). Background: ${design.background_color}.`,
    `Subtle gradient background: linear-gradient(150deg, ${design.background_color} 0%, ${design.accent_light}40 100%). Stronger shadows.`,
  ] as const;
  const styleGuide = variants[slideIndex % variants.length]!;

  return `You are a world-class presentation designer. Create ONE slide as a complete HTML page.
Output ONLY the complete HTML (<!DOCTYPE html> to </html>). No explanation, no markdown fences.

═══ SLIDE ${slideIndex + 1} OF ${totalSlides} ═══
Title: "${title}"

═══ CONTENT TO VISUALIZE ═══
${contentDirection}

═══ DESIGN SYSTEM ═══
Primary: ${design.primary_color} | Accent: ${design.accent_color} | BG: ${design.background_color}
Text: ${design.text_color} | Light: ${design.accent_light} | Gradient: ${design.gradient_end}
Title Font: ${design.font_title} | Body Font: ${design.font_body} | Mood: ${design.mood}

═══ STYLE FOR THIS SLIDE ═══
${styleGuide}

═══ YOUR CREATIVE MISSION ═══
Design the BEST possible visual layout for THIS specific content.
Think like a professional designer: what visual structure best communicates this information?

You have FULL CREATIVE FREEDOM. Choose the most appropriate visual approach:
• Card grids (2×2, 1×3, 1×4) with icons, stats, bullet details
• Styled data tables (<table>) with colored headers and alternating rows
• CSS bar charts: vertical bars using flex-end alignment + height percentages
• Donut/pie charts: conic-gradient on border-radius:50% elements
• Horizontal progress bars with labeled tracks and percentage fills
• Step-by-step process flows with numbered circles + arrow (→) connectors
• Timeline layouts with dated milestone cards in a horizontal row
• Dashboard panels: 2-3 large metric spotlights (80-100px numbers)
• 2-column split: left summary/data + right detailed content or bullets
• Feature showcases with emoji/icon badges
• Itinerary/schedule: day-by-day breakdown with locations and activities
• Ranking/leaderboard: ordered items with visual indicators
• Comparison matrices: side-by-side analysis with visual scoring
• SWOT or quadrant grids for strategic analysis
• Package/pricing comparison: side-by-side product cards with highlights
• Any OTHER CSS-only visual that serves the content perfectly

⚠ Choose the layout that BEST fits THIS content. Match layout to content type: schedules for timelines, charts for financial data, comparison matrices for competitive analysis, card grids for feature showcases. Be creative and appropriate.

═══ MANDATORY CSS BOILERPLATE (copy into <style>) ═══
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1920px; height:1080px; overflow:hidden; font-family:"${design.font_body}","${design.font_title}","Segoe UI","Malgun Gothic",Arial,sans-serif; word-break:keep-all; overflow-wrap:break-word; }
body { display:flex; flex-direction:column; padding:60px 80px; height:1080px; background:${design.background_color}; color:${design.text_color}; font-size:26px; }

═══ HTML STRUCTURE ═══
body has EXACTLY 2 direct children:
1. .slide-title (flex:0 0 auto) — h1 with title + accent bar
   .slide-title h1 { font-size:48px; font-weight:700; color:${design.primary_color}; font-family:"${design.font_title}","Segoe UI",sans-serif; }
   Below h1: <div style="width:80px;height:3px;background:${design.accent_color};border-radius:2px;margin-top:12px"></div>
2. .content (flex:1) — stretches to fill ALL remaining vertical space
   ⚠ .content class name is REQUIRED.
   ⚠ ALL layout elements MUST be DIRECT children of .content — no wrapper divs.

═══ DESIGN RULES ═══
• ${langRule}
• Complete HTML: <!DOCTYPE html> through </html>. ALL styling in <style>.
• NO <img>, NO external resources, NO JavaScript, NO external fonts.
• System fonts ONLY. CSS for visuals: gradients, shapes, shadows, borders.
• Title: 42-48px bold. Body: 28-32px. MINIMUM any visible text: 24px (except page numbers at 12px).
• ⚠ Korean text is WIDER and DENSER than English — use FEWER items with LARGER fonts. Each card/element: MAX 2-3 short lines.
• ⚠ If you need to shrink text below 24px, you have TOO MUCH content. Remove sections or shorten text instead.
• ⚠ ABSOLUTELY NO OVERFLOW — content MUST fit within 1080px total height. It is BETTER to have 20% empty space than 1px of clipping. Limit yourself to 3-4 major content elements max.
• The available height for .content is approximately 900px (1080 - 60px top padding - 60px bottom padding - ~60px title). Design within this constraint.
• ⚠ MAXIMUM visible text: ~800 characters. More than this WILL cause overflow. Be concise — short labels, brief bullet points (max 8-10 words each).
• NEVER use position:absolute for layout (ok for page numbers). Use flexbox/grid.
• NEVER use justify-content:center on .content — it creates dead space. Use stretch/space-evenly.
• Use gradients, box-shadow (0 4px 20px rgba(0,0,0,0.06)), border-radius (12-20px).
• Cards/elements: white (#fff) background with subtle shadow on light slides.
• Table headers: dark background (${design.primary_color}) with white text.
• Generate REAL professional content from the direction. No placeholders.
• ⚠ NEVER use bracket placeholders like [Team Name], [Email], [YYYY], [Author]. Instead, INVENT realistic fictional content for ALL fields — names, emails, dates, numbers, etc.
• If user specified a year, USE THAT YEAR. Default to ${new Date().getFullYear()} only when no year given.
• Page number: bottom-right "${slideIndex + 1}" (12px, opacity 0.4, position:absolute ok for this).

Output the complete HTML now.`;
}

// =============================================================================
// 7b. validateSlideHtml() — Layout-agnostic HTML validation
// =============================================================================

/**
 * Validate generated slide HTML for structure, forbidden patterns,
 * content density, overflow, and font sizes.
 * Layout-agnostic: does NOT check for specific layout types.
 */
export function validateSlideHtml(html: string, _layoutType?: string): { pass: boolean; feedback: string } {
  // 1. HTML structure
  if (!html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
    return { pass: false, feedback: 'Missing <!DOCTYPE html> declaration. Start with <!DOCTYPE html><html>.' };
  }
  if (!html.includes('<html') || !html.includes('</html>')) {
    return { pass: false, feedback: 'Missing <html> or </html> tags. Output must be a complete HTML document.' };
  }

  // 2. Forbidden patterns
  if (/<img\s/i.test(html)) {
    return { pass: false, feedback: 'Forbidden: <img> tags are not allowed. Use CSS gradients, shapes, and backgrounds instead.' };
  }
  if (/<script[\s>]/i.test(html)) {
    return { pass: false, feedback: 'Forbidden: <script> tags are not allowed. This is a static slide — no JavaScript.' };
  }
  const absCount = (html.match(/position\s*:\s*absolute/gi) || []).length;
  if (absCount > 6) {
    return { pass: false, feedback: `Too many position:absolute (${absCount}). Use flexbox/grid for main layout.` };
  }
  const externalUrls = html.match(/url\(\s*['"]?https?:\/\//gi) || [];
  if (externalUrls.length > 0) {
    return { pass: false, feedback: 'Forbidden: External URLs detected in CSS url(). No external resources allowed.' };
  }
  // Detect transform:scale that shrinks content
  const scaleMatches = html.match(/transform\s*:[^;]*scale\(\s*([\d.]+)/gi) || [];
  for (const m of scaleMatches) {
    const val = parseFloat(m.replace(/.*scale\(\s*/i, ''));
    if (val > 0 && val < 0.9) {
      return { pass: false, feedback: `Forbidden: transform:scale(${val}) shrinks content. Use full 1920×1080 layout without scaling.` };
    }
  }

  // 3. Placeholder text detection
  const placeholderPatterns = [
    /Card title \(2-5 words\)/i,
    /Detail with number\/data/i,
    /single emoji/i,
    /Display value \(e\.g\./i,
    /1-2 sentence key insight/i,
    /Category name/i,
    /Segment name/i,
    /Lorem ipsum/i,
    /\[placeholder\]/i,
    /\[\]/i,
    /\[.{2,20}\s*/i,       // [ ] etc.
    /\[YYYY/i,                    // [YYYY MMmonthly]
    /\[/i,                  // [ ]
    /\[/i,                  // []
    /\[/i,                    // [/]
    /\[NNNN\]/i,                  // [NNNN]
    /\[MMmonthly/i,                    // [MMmonthly DD]
    /\[\s*\]/i,           // [ ]
  ];
  for (const pattern of placeholderPatterns) {
    if (pattern.test(html)) {
      return { pass: false, feedback: `Placeholder text detected: "${pattern.source}". Generate REAL content.` };
    }
  }

  // 4. Content density — count text-bearing elements
  const textElements = (html.match(/<(p|li|td|th|span|div|h[1-6])[^>]*>[^<]{2,}/gi) || []).length;
  if (textElements < 5) {
    return { pass: false, feedback: `Low content density: only ${textElements} text elements. Need at least 5.` };
  }

  // 5. Overflow heuristic — tightened to prevent bottom clipping
  const visibleText = html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (visibleText.length > 1200) {
    return { pass: false, feedback: `Content overflow risk: ${visibleText.length} chars of visible text. Reduce to under 1200 chars. Remove 1-2 sections or shorten text to prevent bottom clipping.` };
  }

  // 6. Font size check — no font-size below 22px (allowing page numbers at 12-13px)
  const smallFonts = html.match(/font-size\s*:\s*(\d+)px/gi) || [];
  for (const match of smallFonts) {
    const size = parseInt(match.replace(/[^0-9]/g, ''), 10);
    if (size > 0 && size < 24 && size > 13) {
      return { pass: false, feedback: `Font too small: found font-size:${size}px. Minimum allowed is 24px (except 12-13px for page numbers). Increase font size or reduce content.` };
    }
  }

  return { pass: true, feedback: '' };
}

// =============================================================================
// 8. buildSlideHtmlPrompt() — DEPRECATED fallback (kept for last-resort use)
// =============================================================================

/**
 * @deprecated Use buildDirectHtmlPrompt() instead. Kept as last-resort fallback.
 */
export function buildSlideHtmlPrompt(
  slideTitle: string,
  contentDirection: string,
  design: DesignSystem,
  slideIndex: number,
  totalSlides: number,
  language: 'ko' | 'en',
  layoutType: LayoutType = 'cards',
): string {
  const langRule = language === 'ko'
    ? 'ALL visible text MUST be in Korean. Write naturally in Korean.'
    : 'ALL visible text MUST be in English.';

  // Rotate design styles per slide for variety (simplified to 3 variants for clarity)
  const styleVariants = [
    'LIGHT',           // light bg + cards/elements
    'ACCENT_HEADER',   // accent bar at top, light content below
    'GRADIENT_BG',     // subtle gradient background
  ] as const;
  const styleVariant = styleVariants[slideIndex % styleVariants.length]!;

  const styleGuide: Record<string, string> = {
    'LIGHT': `Background: ${design.background_color}. Title: ${design.primary_color}, 48-56px bold. Cards/elements use white background with box-shadow.`,
    'ACCENT_HEADER': `Add a bold accent bar at top (height:6px, background: linear-gradient(90deg, ${design.accent_color}, ${design.primary_color})). Title directly below. Background: ${design.background_color}.`,
    'GRADIENT_BG': `Subtle gradient background: linear-gradient(150deg, ${design.background_color} 0%, ${design.accent_light} 50%, ${design.background_color} 100%). Elements use stronger shadows (0 8px 32px rgba(0,0,0,0.08)).`,
  };

  return `You are a world-class web designer creating a presentation slide as a complete HTML page.
Output ONLY the complete HTML document — nothing else. No explanation, no markdown fences.

═══ SLIDE INFO ═══
Title: "${slideTitle}"
Slide ${slideIndex + 1} of ${totalSlides}

═══ CONTENT DIRECTION (what to show on this slide) ═══
${contentDirection}

⚠⚠⚠ CRITICAL: The content_direction above is a GUIDE for what content to create.
Generate REAL, specific, professional text based on it. NEVER display the content_direction text literally on the slide.
If it says "3 big metrics: X, Y, Z" → create 3 beautifully formatted metric cards with X, Y, Z values.
If it says "Layout: comparison table" → create a table with the DATA mentioned, not the word "comparison table".

═══ DESIGN SYSTEM ═══
Primary: ${design.primary_color} | Accent: ${design.accent_color} | Background: ${design.background_color}
Text: ${design.text_color} | Accent Light: ${design.accent_light} | Gradient End: ${design.gradient_end}
Title Font: ${design.font_title} | Body Font: ${design.font_body}
Mood: ${design.mood} | Notes: ${design.design_notes}

═══ THIS SLIDE'S VISUAL STYLE ═══
${styleGuide[styleVariant]}
This ensures visual variety across slides. Follow this style direction.

═══ MANDATORY CSS BOILERPLATE — COPY EXACTLY ═══
Your <style> tag MUST start with these EXACT rules (copy verbatim):

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: 1920px; height: 1080px; overflow: hidden;
  font-family: "${design.font_body}", "${design.font_title}", "Segoe UI", "Malgun Gothic", Arial, sans-serif;
  word-break: keep-all;
  overflow-wrap: break-word;
}
body {
  display: flex; flex-direction: column;
  padding: 60px 80px;
  height: 1080px;
}

⚠ word-break:keep-all is CRITICAL for Korean text — without it, words break at random characters.
⚠ body MUST be display:flex + flex-direction:column + height:1080px for vertical fill.
⚠ The main content container (the one with cards/table/chart) MUST use class="content" — required for post-processing.

═══ TECHNICAL REQUIREMENTS ═══
1. Complete HTML: <!DOCTYPE html> through </html>
2. ALL styling in <style> tag — no external resources, images, fonts, or scripts
3. System fonts ONLY. NO <img> tags.
4. Use CSS for visuals: gradients, shapes, shadows, borders, pseudo-elements
5. FIXED pixel layout — NO max-width, NO media queries, NO percentage widths below 80%
6. body IS the container — no wrapper divs. Content goes directly in body.

═══ VERTICAL FILL — THE #1 QUALITY RULE ═══
⚠⚠⚠ Content MUST fill the ENTIRE 1920×1080 slide. Empty space = FAILURE.
⚠⚠⚠ NEVER have more than 150px of empty whitespace anywhere on the slide.

MANDATORY STRUCTURE (body has EXACTLY 2 direct children):
  body (display:flex, flex-direction:column, height:1080px, padding:60px 80px)
    → .slide-title (flex:0 0 auto — title text only, NO extra margin-bottom)
    → .content (flex:1 — STRETCHES to fill ALL remaining vertical space)

⚠ body MUST have exactly 2 direct children: .slide-title and .content. No accent bars, no spacers, no extra divs between them.
⚠ .slide-title should include any accent bars/decorations AS PART OF the title section, not as separate body children.
⚠ .content MUST use flex:1 to stretch. NEVER use justify-content:center on .content — it creates dead space.
⚠⚠⚠ ALL content elements (cards, bars, table, timeline items) MUST be DIRECT CHILDREN of .content. NEVER wrap them in a container/wrapper div inside .content. Wrong: .content > .wrapper > items. Right: .content > items.

${getLayoutSpecificCss(layoutType, design)}

═══ DESIGN RULES ═══
1. Title: 42-48px bold. Body: 26-32px. MINIMUM any visible text: 24px. NEVER use font-size below 24px. If content doesn't fit at 24px, REDUCE ITEM COUNT instead of shrinking text. Card descriptions: 26-30px. Card titles: 32-40px. Labels/captions: 24px minimum. body { font-size: 26px; } is MANDATORY. MAX visible text ~1000 characters.
2. Use gradients, box-shadow (0 4px 20px rgba(0,0,0,0.06)), border-radius (12-20px)
3. Follow the REQUIRED LAYOUT specified above exactly. Do NOT substitute a different layout type.
4. LAYOUT LIMITS: MAX 4 cards (2×2 grid), MAX 2 cards per row. Tables: 5-8 rows for rich data. Timeline: 4-5 steps.
   ⚠ If content_direction lists 5+ items, group them into 4 cards (combine related items).
5. ⚠⚠⚠ NEVER use position:absolute. ALL layout MUST use flexbox/grid. position:absolute is STRIPPED by the renderer.
6. ⚠ NEVER use hub-and-spoke or center-circle layouts (a circle in the center with items around it). The overlapping circle ALWAYS covers text. Use a simple card grid instead.
7. ⚠ MAXIMUM 4 columns in any grid layout. 5+ columns = text too small. Use 2-3 columns + 2 rows instead.
8. PIE/DONUT: conic-gradient on border-radius:50% div ONLY. No clip-path or rotated divs.
9. Bar chart labels: min-width:120px, text-align:center. Never let labels wrap per-character.
10. ⚠ NO LINE CHARTS in CSS — lines/dots never align correctly. Use bar charts (flex-end alignment) or donut charts (conic-gradient) instead.
11. CSS CHARTS THAT WORK: vertical bar charts (flex-end + height%), horizontal bar charts (width%), donut/pie charts (conic-gradient + border-radius:50%), progress bars (width%). Use these liberally for data visualization.
12. Table headers: dark background (${design.primary_color}) with WHITE text. Never transparent.

═══ SPACE UTILIZATION — NO DEAD ZONES ═══
⚠ Content MUST be distributed across the full 1080px height. No section should be >150px of empty whitespace.
⚠ If using a colored header/banner area, it MUST NOT exceed 20% of slide height (216px max).
⚠ The main content area (.content with flex:1) must contain the MAJORITY of visible information.
⚠ Cards stretch to fill height via align-items:stretch from parent — but they MUST have DENSE content inside (see CARD CONTENT DENSITY above).
⚠ NEVER use justify-content:center or align-items:center on .content — it bunches content in the center with empty space around it.
⚠ NEVER use justify-content:space-between on individual cards — it creates huge gaps between sparse items. Use flex-start + gap instead.
⚠ Cards in a row: parent uses align-items:stretch (default) so cards fill the full height.

═══ TABLE COMPLETENESS — MANDATORY ═══
⚠ If you create a table, EVERY cell MUST contain real data. Empty cells = FAILURE.
⚠ For comparison tables: fill ALL columns for ALL competitors/items with realistic data.
⚠ Example: 5-company comparison → all 5 columns must have data in every row.
⚠ NEVER create a table with only 1 column filled — that's not a comparison, it's a list.

═══ CONTENT RULES ═══
• ${langRule}
• Korean text only — never Chinese characters (漢字), Japanese, or other scripts
• Generate REAL, specific content — no placeholders
• BALANCE density and readability — fill 80-90% of the slide area with meaningful content. Avoid both sparse slides and overloaded slides.
• If the user specifies a year in their request, USE THAT YEAR faithfully. Only default to ${new Date().getFullYear()} for content with no explicit year.
• ALL content MUST fit within 1080px height. Use compact padding (24-32px) and dense content. Fill 85-95% of slide area.
• Each section: 3-5 detailed bullet points with specific data. Dense content beats wide padding.
• body MUST set font-size: 26px as the base. All text inherits at least 26px unless explicitly larger.

═══ PAGE NUMBER ═══
Bottom-right: "${slideIndex + 1}" (12px, opacity 0.4)

Output the complete HTML document now. Start with <!DOCTYPE html> and end with </html>.`;
}

// =============================================================================
// 9. Content Slide Data Interfaces
// =============================================================================

export interface CardsSlideData {
  cards: Array<{ icon: string; title: string; bullets: string[]; stat?: string }>;
}

export interface BarChartSlideData {
  bars: Array<{ label: string; value: string; height: number }>;
  insight: string;
}

export interface DonutChartSlideData {
  segments: Array<{ label: string; value: string; percent: number }>;
  centerText: string;
  summary: string;
}

export interface TableSlideData {
  headers: string[];
  rows: string[][];
  highlightRow?: number;
  summary: string;
}

export interface ProcessFlowSlideData {
  steps: Array<{ title: string; desc: string; detail: string }>;
}

export interface BigNumbersSlideData {
  metrics: Array<{ value: string; unit: string; label: string; desc: string; trend: string; positive: boolean }>;
}

export interface TimelineSlideData {
  milestones: Array<{ date: string; title: string; desc: string; kpi: string }>;
}

export interface ProgressBarsSlideData {
  bars: Array<{ label: string; value: string; percent: number; detail: string }>;
}

export interface HeroStatSlideData {
  number: string; unit: string; label: string; context: string;
  supporting: Array<{ value: string; label: string }>;
}

export interface TwoColSplitSlideData {
  leftTitle: string;
  leftItems: Array<{ label: string; value: string }>;
  rightTitle: string;
  rightBullets: string[];
}

export type ContentSlideData =
  | CardsSlideData
  | BarChartSlideData
  | DonutChartSlideData
  | TableSlideData
  | ProcessFlowSlideData
  | BigNumbersSlideData
  | TimelineSlideData
  | ProgressBarsSlideData
  | HeroStatSlideData
  | TwoColSplitSlideData;

// =============================================================================
// 10. buildContentFillJsonPrompt() — fallback JSON data extraction
// =============================================================================

export function buildContentFillJsonPrompt(
  slideTitle: string,
  contentDirection: string,
  layoutType: LayoutType,
  language: 'ko' | 'en',
): string {
  const langRule = language === 'ko'
    ? 'ALL text MUST be in Korean. Write naturally in Korean. Never use Chinese characters (漢字).'
    : 'ALL text MUST be in English.';

  const schemas: Record<LayoutType, string> = {
    cards: `{
  "cards": [
    { "icon": "single emoji", "title": "Short card title (2-5 words)", "bullets": ["Detail with data", "Another detail", "Third point"], "stat": "Key metric with number" }
  ]
}
RULES: 3-4 cards. Each: icon + title + 3 bullets (MAX 3, keep each under 25 chars) + stat.`,

    bar_chart: `{
  "bars": [
    { "label": "Category name (under 15 chars)", "value": "Number with unit", "height": 85 }
  ],
  "insight": "1-2 sentence key insight about the data"
}
RULES: 4-5 bars (MAX 5). height: 10-90 (tallest=85, others proportional). Values must include units.`,

    donut_chart: `{
  "segments": [
    { "label": "Segment name", "value": "Number with unit", "percent": 45 }
  ],
  "centerText": "Total or summary label",
  "summary": "1-2 sentence summary"
}
RULES: 3-5 segments. Percents MUST sum to exactly 100.`,

    table: `{
  "headers": ["Descriptive column name", "Another column", "Third column", "Fourth column"],
  "rows": [["real data", "real data", "real data", "real data"]],
  "highlightRow": 0,
  "summary": "1-2 sentence summary"
}
RULES: 3-4 columns. 4-5 rows. ALL cells must contain real data. highlightRow: 0-indexed or null.
⚠ headers MUST be meaningful column names — NEVER use generic "Column 1", "Column 2".`,

    process_flow: `{
  "steps": [
    { "title": "Step name (2-4 words)", "desc": "2-3 sentence description with specific details", "detail": "Duration or key metric" }
  ]
}
RULES: 3-4 steps (MAX 4). Each: title + detailed description + time/metric.`,

    big_numbers: `{
  "metrics": [
    { "value": "Number only", "unit": "Unit text", "label": "Metric name", "desc": "1-2 sentence context", "trend": "▲ or ▼ + percentage", "positive": true }
  ]
}
RULES: 2-3 metrics. value=number only, unit=separate field. trend: ▲/▼ + percentage.`,

    timeline: `{
  "milestones": [
    { "date": "Date or period", "title": "Milestone name", "desc": "2-3 sentence description", "kpi": "Target metric" }
  ]
}
RULES: 3 milestones (MAX 3). Each with date, description, and KPI target.`,

    progress_bars: `{
  "bars": [
    { "label": "Category name", "value": "Display value with unit", "percent": 75, "detail": "Brief context" }
  ]
}
RULES: 4-6 bars. percent: 5-100. Include context detail for each.`,

    hero_stat: `{
  "number": "The big number",
  "unit": "Unit or symbol",
  "label": "What this number measures",
  "context": "2-3 sentence context explaining significance",
  "supporting": [
    { "value": "Number with unit", "label": "Supporting metric name" }
  ]
}
RULES: 1 hero number + context + 2-3 supporting metrics.`,

    two_col_split: `{
  "leftTitle": "Left column heading",
  "leftItems": [
    { "label": "Item name", "value": "Item value with data" }
  ],
  "rightTitle": "Right column heading",
  "rightBullets": ["Detailed bullet point with data"]
}
RULES: Left: 3-4 key-value items with REAL data. Right: 3-4 detailed bullets with REAL data. Keep each bullet under 30 chars.`,
  };

  return `Extract content from the direction below and output ONLY valid JSON.
Do NOT output markdown fences, explanations, or anything besides the JSON object.

SLIDE TITLE: "${slideTitle}"
LAYOUT TYPE: ${layoutType}

CONTENT DIRECTION:
${contentDirection}

REQUIRED JSON SCHEMA:
${schemas[layoutType]}

${langRule}
Use SPECIFIC numbers, names, percentages from the content direction.
Each text field must be substantive (not 1-2 generic words).
If the content direction lacks specific data, generate realistic professional data that fits the topic.

Output the JSON object now:`;
}

// =============================================================================
// 11. parseContentFillJson()
// =============================================================================

export function parseContentFillJson(raw: string, layoutType: LayoutType): ContentSlideData | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Repair: trailing commas, unescaped newlines
    try {
      const repaired = cleaned.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  if (!parsed) return null;

  // Reject if JSON contains only ellipsis/placeholder content
  const jsonStr = JSON.stringify(parsed);
  const ellipsisMatches = jsonStr.match(/"\.\.\."|\u2026/g) || [];
  const totalStringValues = jsonStr.match(/"[^"]+"/g) || [];
  if (ellipsisMatches.length > 0 && totalStringValues.length > 0) {
    const ellipsisRatio = ellipsisMatches.length / totalStringValues.length;
    if (ellipsisRatio > 0.3) {
      return null; // Too many ellipsis values — reject as placeholder content
    }
  }

  // Reject if JSON has literal "string" type-name placeholders
  const stringLiteralMatches = jsonStr.match(/"string"/g) || [];
  if (stringLiteralMatches.length >= 2) {
    return null; // LLM returned TypeScript type names instead of content
  }

  // Basic structural validation
  switch (layoutType) {
    case 'cards':
      if (!Array.isArray(parsed['cards']) || (parsed['cards'] as unknown[]).length === 0) return null;
      break;
    case 'bar_chart':
      if (!Array.isArray(parsed['bars']) || (parsed['bars'] as unknown[]).length === 0) return null;
      break;
    case 'donut_chart':
      if (!Array.isArray(parsed['segments']) || (parsed['segments'] as unknown[]).length === 0) return null;
      break;
    case 'table':
      if (!Array.isArray(parsed['headers']) || !Array.isArray(parsed['rows'])) return null;
      break;
    case 'process_flow':
      if (!Array.isArray(parsed['steps']) || (parsed['steps'] as unknown[]).length === 0) return null;
      break;
    case 'big_numbers':
      if (!Array.isArray(parsed['metrics']) || (parsed['metrics'] as unknown[]).length === 0) return null;
      break;
    case 'timeline':
      if (!Array.isArray(parsed['milestones']) || (parsed['milestones'] as unknown[]).length === 0) return null;
      break;
    case 'progress_bars':
      if (!Array.isArray(parsed['bars']) || (parsed['bars'] as unknown[]).length === 0) return null;
      break;
    case 'hero_stat':
      if (!parsed['number']) return null;
      break;
    case 'two_col_split':
      if (!parsed['leftTitle'] && !parsed['rightTitle']) return null;
      if (!Array.isArray(parsed['leftItems']) || (parsed['leftItems'] as unknown[]).length === 0) return null;
      if (!Array.isArray(parsed['rightBullets']) || (parsed['rightBullets'] as unknown[]).length === 0) return null;
      break;
  }

  // Minimum content check: reject if total text content is too sparse
  const allText = JSON.stringify(parsed).replace(/[{}\[\]",:]/g, '').trim();
  if (allText.length < 50) return null;

  return parsed as unknown as ContentSlideData;
}

// =============================================================================
// 12. getCardTextColor()
// =============================================================================

/**
 * Returns a dark text color for use inside white-background cards.
 * When the slide background is dark, design.text_color is light (for contrast).
 * But cards have white bg, so we need dark text inside them.
 */
function getCardTextColor(design: DesignSystem): string {
  const hex = (design.background_color || '#f8f9fa').replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 200;
  const g = parseInt(hex.slice(2, 4), 16) || 200;
  const b = parseInt(hex.slice(4, 6), 16) || 200;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Dark background → use hardcoded dark text for white cards
  return luminance < 0.5 ? '#2D3748' : design.text_color;
}

// =============================================================================
// 13. escapeHtmlTemplate()
// =============================================================================

function escapeHtmlTemplate(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// 14. wrapSlide()
// =============================================================================

function wrapSlide(
  design: DesignSystem,
  title: string,
  slideNum: number,
  contentCss: string,
  contentHtml: string,
  variant: number = 0,
): string {
  const bgVariants = [
    `background:${design.background_color};`,
    `background:linear-gradient(160deg,${design.background_color} 0%,${design.accent_light}40 100%);`,
    `background:${design.background_color};`,
  ];
  const bodyBg = bgVariants[variant % bgVariants.length]!;
  const accentBar = variant % 3 === 2
    ? `<div style="height:4px;background:linear-gradient(90deg,${design.accent_color},${design.primary_color});margin-bottom:12px;border-radius:2px;flex-shrink:0"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden;font-family:"${design.font_body}","${design.font_title}","Segoe UI","Malgun Gothic",Arial,sans-serif;word-break:keep-all;overflow-wrap:break-word}
body{display:flex;flex-direction:column;padding:60px 80px;height:1080px;${bodyBg}color:${design.text_color};font-size:26px}
.slide-title{flex:0 0 auto;margin-bottom:20px}
.slide-title h1{font-size:48px;font-weight:700;color:${design.primary_color};font-family:"${design.font_title}","Segoe UI",sans-serif}
.title-bar{width:80px;height:3px;background:${design.accent_color};border-radius:2px;margin-top:12px}
.page-number{position:absolute;bottom:20px;right:80px;font-size:12px;opacity:0.4}
${contentCss}
</style></head>
<body>
<div class="slide-title">${accentBar}<h1>${escapeHtmlTemplate(title)}</h1><div class="title-bar"></div></div>
${contentHtml}
<div class="page-number">${slideNum}</div>
</body></html>`;
}

// =============================================================================
// 15. build*Content() template builders
// =============================================================================

function buildCardsContent(design: DesignSystem, data: CardsSlideData): { css: string; html: string } {
  const n = Math.min((data.cards || []).length, 4);
  const cols = n <= 3 ? `repeat(${n},1fr)` : '1fr 1fr';
  const is2x2 = n === 4;
  // Both 2×2 and 1×3: use 1fr rows so cards stretch to fill the full height
  const gridExtra = is2x2 ? 'grid-template-rows:1fr 1fr' : 'grid-template-rows:1fr';
  const cardPad = is2x2 ? '28px 24px' : '48px 36px';
  const cardGap = is2x2 ? '10px' : '16px';
  const h2Size = is2x2 ? '32px' : '40px';
  const liSize = is2x2 ? '26px' : '30px';
  const liMargin = is2x2 ? '8px' : '14px';

  const cardText = getCardTextColor(design);
  const css = `.content{flex:1;display:grid;grid-template-columns:${cols};${gridExtra};gap:24px}
.card{background:#fff;border-radius:16px;padding:${cardPad};box-shadow:0 4px 20px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:${cardGap};overflow:hidden;color:${cardText}}
.card-icon{font-size:36px;line-height:1}
.card h2{font-size:${h2Size};font-weight:700;color:${design.primary_color}}
.card ul{list-style:none;flex:1;display:flex;flex-direction:column;justify-content:center}
.card li{margin-bottom:${liMargin};padding-left:22px;position:relative;font-size:${liSize};line-height:1.4}
.card li::before{content:"•";color:${design.accent_color};position:absolute;left:0;font-weight:bold}
.card-stat{margin-top:auto;padding-top:12px;border-top:2px solid ${design.accent_light};font-size:24px;font-weight:600;color:${design.accent_color}}`;

  // Limit to 3 bullets per card regardless of count to prevent overflow
  const maxBullets = 3;
  const cards = (data.cards || []).slice(0, 4).map(c => `
  <div class="card">
    <div class="card-icon">${c.icon || '📌'}</div>
    <h2>${escapeHtmlTemplate(c.title || '')}</h2>
    <ul>${(c.bullets || []).slice(0, maxBullets).map(b => `<li>${escapeHtmlTemplate(b)}</li>`).join('')}</ul>
    ${c.stat ? `<div class="card-stat">${escapeHtmlTemplate(c.stat)}</div>` : ''}
  </div>`).join('');

  return { css, html: `<div class="content">${cards}\n</div>` };
}

function buildBarChartContent(design: DesignSystem, data: BarChartSlideData): { css: string; html: string } {
  const cardText = getCardTextColor(design);
  const css = `.content{flex:1;display:flex;flex-direction:column}
.chart-area{flex:1;display:flex;align-items:stretch;gap:32px;padding:20px 60px 0}
.bar-group{flex:1;display:flex;flex-direction:column;align-items:center}
.bar-spacer{flex:1}
.bar-value{font-size:28px;font-weight:700;color:${design.primary_color};margin-bottom:8px;flex-shrink:0}
.bar{width:80%;border-radius:8px 8px 0 0;background:linear-gradient(180deg,${design.accent_color},${design.primary_color});flex-shrink:0}
.bar-label{font-size:24px;font-weight:600;color:${design.text_color};text-align:center;min-width:120px;word-break:keep-all;padding:12px 0;flex-shrink:0}
.insight-row{padding:20px 60px;background:${design.accent_light};border-radius:12px;margin-top:16px;font-size:26px;color:${cardText};line-height:1.5;flex-shrink:0}`;

  // Calculate max height to normalize bars — tallest bar gets 85% of space
  const maxH = Math.max(...(data.bars || []).map(b => b.height || 50), 1);
  const bars = (data.bars || []).slice(0, 5).map(b => {
    const normalized = Math.max(8, Math.round(((b.height || 50) / maxH) * 85));
    // Use flex-grow for spacer, fixed height for bar based on ratio
    return `
    <div class="bar-group">
      <div class="bar-spacer"></div>
      <div class="bar-value">${escapeHtmlTemplate(b.value || '')}</div>
      <div class="bar" style="height:${normalized}%"></div>
      <div class="bar-label">${escapeHtmlTemplate(b.label || '')}</div>
    </div>`;
  }).join('');

  return {
    css,
    html: `<div class="content">
  <div class="chart-area">${bars}</div>
  <div class="insight-row">${escapeHtmlTemplate(data.insight || '')}</div>
</div>`,
  };
}

function buildDonutChartContent(design: DesignSystem, data: DonutChartSlideData): { css: string; html: string } {
  const segColors = [design.primary_color, design.accent_color, design.gradient_end, '#FF6B6B', '#4ECDC4', '#45B7D1'];
  const segs = (data.segments || []).slice(0, 6);
  // Normalize percentages to sum to 100
  const totalPct = segs.reduce((s, seg) => s + (seg.percent || 0), 0);
  let cumPct = 0;
  const stops = segs.map((s, i) => {
    const start = cumPct;
    const pct = totalPct > 0 ? (s.percent / totalPct) * 100 : 100 / segs.length;
    cumPct += pct;
    return `${segColors[i % segColors.length]} ${start.toFixed(1)}% ${cumPct.toFixed(1)}%`;
  }).join(',');

  const css = `.content{flex:1;display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center;align-content:center;padding:0}
.donut-wrap{display:flex;justify-content:center;align-items:center}
.donut{width:600px;height:600px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(0,0,0,0.08)}
.donut-hole{width:290px;height:290px;border-radius:50%;background:${design.background_color};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px}
.donut-center{font-size:34px;font-weight:800;color:${design.primary_color};text-align:center;line-height:1.3}
.legend{display:flex;flex-direction:column;gap:24px}
.legend-item{display:flex;align-items:center;gap:16px;font-size:28px;padding:14px 18px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04);color:${getCardTextColor(design)}}
.legend-dot{width:24px;height:24px;border-radius:50%;flex-shrink:0}
.legend-value{font-weight:700;color:${design.primary_color};margin-left:auto;white-space:nowrap}
.chart-summary{padding:16px 20px;background:${design.accent_light};border-radius:12px;font-size:24px;color:${getCardTextColor(design)};line-height:1.5;margin-top:8px}`;

  const legendHtml = segs.map((s, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${segColors[i % segColors.length]}"></div>
      <span>${escapeHtmlTemplate(s.label || '')}</span>
      <span class="legend-value">${escapeHtmlTemplate(s.value || '')} (${s.percent}%)</span>
    </div>`).join('');

  return {
    css,
    html: `<div class="content">
  <div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(${stops})">
      <div class="donut-hole"><div class="donut-center">${escapeHtmlTemplate(data.centerText || '')}</div></div>
    </div>
  </div>
  <div class="legend">${legendHtml}
    ${data.summary ? `<div class="chart-summary">${escapeHtmlTemplate(data.summary)}</div>` : ''}
  </div>
</div>`,
  };
}

function buildTableContent(design: DesignSystem, data: TableSlideData): { css: string; html: string } {
  const cardText = getCardTextColor(design);
  const maxCols = Math.min((data.headers || []).length, 4);
  const css = `.content{flex:1;display:flex;flex-direction:column;justify-content:center}
.data-table{width:100%;border-collapse:collapse;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.05);border-radius:12px;overflow:hidden;table-layout:fixed}
.data-table th{background:${design.primary_color};color:#fff;font-size:28px;text-align:left;padding:22px 28px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.data-table td{font-size:28px;color:${cardText};padding:22px 28px;border-bottom:1px solid ${design.accent_light};overflow:hidden;word-break:break-word}
.data-table tr:last-child td{border-bottom:none}
.data-table tr:nth-child(even){background:${design.accent_light}20}
.data-table tr.highlight td{background:${design.accent_color}15;font-weight:600}
.table-summary{margin-top:20px;padding:16px 24px;background:${design.accent_light};border-radius:12px;font-size:26px;color:${cardText};line-height:1.5}`;

  const headers = (data.headers || []).slice(0, maxCols).map(h =>
    `<th>${escapeHtmlTemplate(String(h || '').slice(0, 25))}</th>`).join('');
  const rows = (data.rows || []).slice(0, 5).map((row, ri) => {
    const cls = ri === data.highlightRow ? ' class="highlight"' : '';
    const cells = (row || []).slice(0, maxCols).map(c =>
      `<td>${escapeHtmlTemplate(String(c || '').slice(0, 50))}</td>`).join('');
    return `<tr${cls}>${cells}</tr>`;
  }).join('\n');

  return {
    css,
    html: `<div class="content">
  <table class="data-table"><thead><tr>${headers}</tr></thead><tbody>\n${rows}\n</tbody></table>
  ${data.summary ? `<div class="table-summary">${escapeHtmlTemplate(data.summary)}</div>` : ''}
</div>`,
  };
}

function buildProcessFlowContent(design: DesignSystem, data: ProcessFlowSlideData): { css: string; html: string } {
  const n = Math.min((data.steps || []).length, 4);
  const cardText = getCardTextColor(design);
  // Adaptive sizing: fewer steps = larger fonts
  const titleSz = n <= 3 ? '34px' : '32px';
  const descSz = n <= 3 ? '28px' : '26px';
  const detailSz = n <= 3 ? '28px' : '26px';
  const css = `.content{flex:1;display:flex;align-items:stretch;gap:0}
.step{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 24px;background:#fff;border-radius:16px;text-align:center;gap:16px;box-shadow:0 4px 20px rgba(0,0,0,0.06)}
.step-num{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,${design.primary_color},${design.gradient_end});color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;flex-shrink:0}
.step-title{font-size:${titleSz};font-weight:700;color:${design.primary_color}}
.step-desc{font-size:${descSz};color:${cardText};line-height:1.5}
.step-detail{font-size:${detailSz};color:${design.accent_color};font-weight:600;padding-top:14px;border-top:2px solid ${design.accent_color}40}
.arrow{width:48px;display:flex;align-items:center;justify-content:center;font-size:40px;color:${design.accent_color};flex-shrink:0}`;

  const steps = (data.steps || []).slice(0, 4);
  // Limit description length to prevent text overflow in narrow columns
  const maxDescLen = n <= 3 ? 120 : 80;
  const stepsHtml = steps.map((s, i) => {
    const desc = (s.desc || '').slice(0, maxDescLen);
    const stepDiv = `
  <div class="step">
    <div class="step-num">${i + 1}</div>
    <div class="step-title">${escapeHtmlTemplate(s.title || '')}</div>
    <div class="step-desc">${escapeHtmlTemplate(desc)}</div>
    ${s.detail ? `<div class="step-detail">${escapeHtmlTemplate(s.detail)}</div>` : ''}
  </div>`;
    return i < steps.length - 1 ? stepDiv + '\n  <div class="arrow">→</div>' : stepDiv;
  }).join('');

  return { css, html: `<div class="content">${stepsHtml}\n</div>` };
}

function buildBigNumbersContent(design: DesignSystem, data: BigNumbersSlideData): { css: string; html: string } {
  const cardText = getCardTextColor(design);
  const css = `.content{flex:1;display:flex;gap:40px;align-items:center}
.metric-card{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:56px 36px;border-radius:20px;background:#fff;box-shadow:0 6px 28px rgba(0,0,0,0.08);text-align:center;gap:20px;border-top:4px solid ${design.accent_color}}
.metric-value{font-size:100px;font-weight:800;color:${design.primary_color};line-height:1}
.metric-unit{font-size:36px;font-weight:600;color:${design.accent_color}}
.metric-label{font-size:32px;font-weight:600;color:${cardText}}
.metric-desc{font-size:26px;color:${cardText}aa;line-height:1.5;max-width:90%}
.metric-trend{font-size:28px;font-weight:600}`;

  const metrics = (data.metrics || []).slice(0, 3).map(m => `
  <div class="metric-card">
    <div class="metric-value">${escapeHtmlTemplate(m.value || '')}</div>
    <div class="metric-unit">${escapeHtmlTemplate(m.unit || '')}</div>
    <div class="metric-label">${escapeHtmlTemplate(m.label || '')}</div>
    <div class="metric-desc">${escapeHtmlTemplate(m.desc || '')}</div>
    <div class="metric-trend" style="color:${m.positive !== false ? '#10B981' : '#EF4444'}">${escapeHtmlTemplate(m.trend || '')}</div>
  </div>`).join('');

  return { css, html: `<div class="content">${metrics}\n</div>` };
}

function buildTimelineContent(design: DesignSystem, data: TimelineSlideData): { css: string; html: string } {
  // Max 3 milestones — generous sizing
  const titleSz = '40px';
  const descSz = '32px';
  const kpiSz = '30px';
  const pad = '44px 40px';
  const css = `.content{flex:1;display:flex;align-items:stretch;gap:24px}
.milestone{flex:1;display:flex;flex-direction:column;justify-content:center;padding:${pad};border-radius:16px;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.06);gap:18px}
.ms-date{display:inline-block;padding:8px 18px;border-radius:8px;background:${design.primary_color};color:#fff;font-size:26px;font-weight:700;align-self:flex-start}
.ms-title{font-size:${titleSz};font-weight:700;color:${design.primary_color}}
.ms-desc{font-size:${descSz};color:${getCardTextColor(design)};line-height:1.55}
.ms-kpi{font-size:${kpiSz};font-weight:600;color:${design.accent_color};padding-top:16px;border-top:2px solid ${design.accent_light}}`;

  const milestones = (data.milestones || []).slice(0, 3).map((m) => `
  <div class="milestone">
    <div class="ms-date">${escapeHtmlTemplate(m.date || '')}</div>
    <div class="ms-title">${escapeHtmlTemplate(m.title || '')}</div>
    <div class="ms-desc">${escapeHtmlTemplate(m.desc || '')}</div>
    ${m.kpi ? `<div class="ms-kpi">${escapeHtmlTemplate(m.kpi)}</div>` : ''}
  </div>`).join('');

  return { css, html: `<div class="content">${milestones}\n</div>` };
}

function buildProgressBarsContent(design: DesignSystem, data: ProgressBarsSlideData): { css: string; html: string } {
  const barCount = Math.min((data.bars || []).length, 6);
  // Adaptive spacing: reduce gap and bar height for 5+ bars to prevent overflow
  const barGap = barCount >= 5 ? '28px' : '44px';
  const barHeight = barCount >= 5 ? '44px' : '56px';
  const barRadius = barCount >= 5 ? '22px' : '28px';
  const css = `.content{flex:1;display:flex;flex-direction:column;justify-content:center;gap:${barGap};padding:20px 0}
.bar-item{display:flex;flex-direction:column;gap:10px}
.bar-header{display:flex;justify-content:space-between;align-items:baseline}
.bar-label{font-size:32px;font-weight:600;color:${design.text_color}}
.bar-val{font-size:32px;font-weight:700;color:${design.primary_color}}
.bar-track{width:100%;height:${barHeight};background:${design.accent_light};border-radius:${barRadius};overflow:hidden}
.bar-fill{height:100%;border-radius:${barRadius};background:linear-gradient(90deg,${design.primary_color},${design.accent_color})}
.bar-detail{font-size:26px;color:${design.text_color}88;margin-top:-2px}`;

  const bars = (data.bars || []).slice(0, 6).map(b => `
  <div class="bar-item">
    <div class="bar-header"><span class="bar-label">${escapeHtmlTemplate(b.label || '')}</span><span class="bar-val">${escapeHtmlTemplate(b.value || '')}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, Math.min(100, b.percent || 50))}%"></div></div>
    ${b.detail ? `<div class="bar-detail">${escapeHtmlTemplate(b.detail)}</div>` : ''}
  </div>`).join('');

  return { css, html: `<div class="content">${bars}\n</div>` };
}

function buildHeroStatContent(design: DesignSystem, data: HeroStatSlideData): { css: string; html: string } {
  const css = `.content{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.hero-number{font-size:128px;font-weight:900;color:${design.primary_color};line-height:1}
.hero-unit{font-size:48px;font-weight:600;color:${design.accent_color}}
.hero-label{font-size:36px;font-weight:600;color:${design.text_color}}
.hero-context{font-size:28px;color:${design.text_color}aa;text-align:center;max-width:800px;line-height:1.6}
.supporting-row{display:flex;gap:60px;margin-top:48px}
.sup-item{text-align:center}
.sup-value{font-size:40px;font-weight:700;color:${design.primary_color}}
.sup-label{font-size:24px;color:${design.text_color}aa;margin-top:8px}`;

  const supporting = (data.supporting || []).slice(0, 3).map(s => `
    <div class="sup-item">
      <div class="sup-value">${escapeHtmlTemplate(s.value || '')}</div>
      <div class="sup-label">${escapeHtmlTemplate(s.label || '')}</div>
    </div>`).join('');

  return {
    css,
    html: `<div class="content">
  <div class="hero-number">${escapeHtmlTemplate(data.number || '')}</div>
  <div class="hero-unit">${escapeHtmlTemplate(data.unit || '')}</div>
  <div class="hero-label">${escapeHtmlTemplate(data.label || '')}</div>
  <div class="hero-context">${escapeHtmlTemplate(data.context || '')}</div>
  ${supporting ? `<div class="supporting-row">${supporting}</div>` : ''}
</div>`,
  };
}

function buildTwoColSplitContent(design: DesignSystem, data: TwoColSplitSlideData): { css: string; html: string } {
  const css = `.content{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:stretch}
.col{display:flex;flex-direction:column;gap:14px;justify-content:space-evenly}
.col h2{font-size:36px;font-weight:700;color:${design.primary_color};margin-bottom:12px;padding-bottom:12px;border-bottom:3px solid ${design.accent_color}}
.kv-item{display:flex;justify-content:space-between;align-items:center;padding:28px 28px;background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,0.04);font-size:30px;color:${getCardTextColor(design)}}
.kv-label{color:${getCardTextColor(design)};font-weight:500}
.kv-value{color:${design.primary_color};font-weight:700;font-size:30px}
.col ul{list-style:none;display:flex;flex-direction:column;gap:12px}
.col li{padding:20px 20px 20px 34px;position:relative;font-size:28px;line-height:1.5;background:#fff;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,0.03);color:${getCardTextColor(design)}}
.col li::before{content:"•";color:${design.accent_color};position:absolute;left:12px;font-weight:bold}`;

  const leftItems = (data.leftItems || []).slice(0, 4).map(item => `
    <div class="kv-item"><span class="kv-label">${escapeHtmlTemplate(item.label || '')}</span><span class="kv-value">${escapeHtmlTemplate(item.value || '')}</span></div>`).join('');

  const rightBullets = (data.rightBullets || []).slice(0, 4).map(b => `<li>${escapeHtmlTemplate(b)}</li>`).join('');

  return {
    css,
    html: `<div class="content">
  <div class="col">
    <h2>${escapeHtmlTemplate(data.leftTitle || '')}</h2>
    ${leftItems}
  </div>
  <div class="col">
    <h2>${escapeHtmlTemplate(data.rightTitle || '')}</h2>
    <ul>${rightBullets}</ul>
  </div>
</div>`,
  };
}

// =============================================================================
// 16. buildContentSlideHtml() — Dispatcher
// =============================================================================

export function buildContentSlideHtml(
  design: DesignSystem,
  title: string,
  layoutType: LayoutType,
  data: ContentSlideData,
  slideNum: number,
  variant: number = 0,
): string {
  const builders: Record<LayoutType, (d: DesignSystem, data: ContentSlideData) => { css: string; html: string }> = {
    cards: (d, dt) => buildCardsContent(d, dt as CardsSlideData),
    bar_chart: (d, dt) => buildBarChartContent(d, dt as BarChartSlideData),
    donut_chart: (d, dt) => buildDonutChartContent(d, dt as DonutChartSlideData),
    table: (d, dt) => buildTableContent(d, dt as TableSlideData),
    process_flow: (d, dt) => buildProcessFlowContent(d, dt as ProcessFlowSlideData),
    big_numbers: (d, dt) => buildBigNumbersContent(d, dt as BigNumbersSlideData),
    timeline: (d, dt) => buildTimelineContent(d, dt as TimelineSlideData),
    progress_bars: (d, dt) => buildProgressBarsContent(d, dt as ProgressBarsSlideData),
    hero_stat: (d, dt) => buildHeroStatContent(d, dt as HeroStatSlideData),
    two_col_split: (d, dt) => buildTwoColSplitContent(d, dt as TwoColSplitSlideData),
  };

  const builder = builders[layoutType] || builders.cards;
  const content = builder(design, data);
  return wrapSlide(design, title, slideNum, content.css, content.html, variant);
}

// =============================================================================
// Layout-Specific CSS (internal helper for buildDirectHtmlPrompt & buildSlideHtmlPrompt)
// =============================================================================

/**
 * Get layout-specific prompt for a given layout type.
 * Returns CSS + critical HTML pattern snippet + rules.
 */
function getLayoutSpecificCss(layoutType: LayoutType, design: DesignSystem): string {
  const layouts: Record<LayoutType, string> = {
    cards: `═══ REQUIRED LAYOUT: CARD GRID ═══
⚠⚠⚠ You MUST create a CARD GRID layout. Using any other layout = FAILURE.

CSS:
.content { flex:1; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:24px; }
.card { display:flex; flex-direction:column; justify-content:flex-start; gap:12px; padding:32px 28px; border-radius:16px; background:#fff; box-shadow:0 4px 20px rgba(0,0,0,0.06); overflow:hidden; }

⚠ grid-template-rows:1fr 1fr is CRITICAL — it forces cards to stretch and fill vertical space. Without it, cards collapse to content height leaving huge empty bottom.
• MAX 4 cards (2×2). Each: icon/badge + title (32-40px) + 3 bullets (26px, MAX 3 per card, each under 25 chars) + stat/metric at bottom.
• If only 3 items: grid-template-columns:1fr 1fr 1fr; grid-template-rows:1fr; (all 3 in one row)
• MINIMUM CARD CONTENT: title + 3 bullet points with numbers/data + bottom metric. A card with only 1 bullet = FAILURE.
• Card bottom stat: use margin-top:auto to push it to card bottom, creating visual anchor.
• ⚠ NEVER have empty grid cells. If you have 3 items, use 3 columns. If 4, use 2×2.`,

    bar_chart: `═══ REQUIRED LAYOUT: BAR CHART ═══
⚠⚠⚠ You MUST create a CSS BAR CHART with vertical bars. Cards/numbers/tables = FAILURE.

CSS:
.content { flex:1; display:flex; flex-direction:column; }
.chart-area { flex:1; display:flex; align-items:flex-end; gap:32px; padding:40px 60px 20px; }
.bar-group { flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; }
.bar-value { font-size:28px; font-weight:700; color:${design.primary_color}; }
.bar { width:80%; border-radius:8px 8px 0 0; background:linear-gradient(180deg, ${design.accent_color}, ${design.primary_color}); min-height:20px; }
.bar-label { font-size:26px; font-weight:600; color:${design.text_color}; text-align:center; min-width:120px; }
.insight-row { padding:20px 60px; background:${design.accent_light}; border-radius:12px; margin-top:20px; font-size:26px; color:${design.text_color}; }

CRITICAL PATTERN — your .content div MUST contain this structure:
<div class="content">
  <div class="chart-area">
    <div class="bar-group">
      <div class="bar-value">VALUE</div>
      <div class="bar" style="height:75%"></div>
      <div class="bar-label">LABEL</div>
    </div>
    <!-- 3-6 bar-groups like above -->
  </div>
  <div class="insight-row">KEY INSIGHT TEXT</div>
</div>

⚠ Each bar MUST have style="height:XX%" (tallest=85%, others proportional). align-items:flex-end on .chart-area makes bars grow upward.
⚠ The insight-row at bottom provides context and fills space. Be creative with the insight text.
⚠⚠⚠ .chart-area and .insight-row MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    donut_chart: `═══ REQUIRED LAYOUT: DONUT/PIE CHART ═══
⚠⚠⚠ You MUST create a CSS DONUT CHART using conic-gradient. Cards/tables = FAILURE.

CSS:
.content { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center; }
.donut-wrap { display:flex; justify-content:center; align-items:center; }
.donut { width:400px; height:400px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
.donut-hole { width:200px; height:200px; border-radius:50%; background:${design.background_color}; display:flex; align-items:center; justify-content:center; }
.donut-center { font-size:48px; font-weight:800; color:${design.primary_color}; }
.legend { display:flex; flex-direction:column; gap:28px; }
.legend-item { display:flex; align-items:center; gap:16px; font-size:28px; }
.legend-dot { width:20px; height:20px; border-radius:50%; flex-shrink:0; }

CRITICAL PATTERN — the donut MUST use conic-gradient with ACTUAL data percentages:
<div class="donut" style="background:conic-gradient(${design.primary_color} 0% 45%, ${design.accent_color} 45% 75%, ${design.gradient_end} 75% 100%);">

⚠ conic-gradient segments MUST add to 100%. Adjust percentages to match the ACTUAL DATA.
⚠ Left: donut with center hole showing total/summary. Right: legend with colored dots + labels + values.`,

    table: `═══ REQUIRED LAYOUT: DATA TABLE ═══
⚠⚠⚠ You MUST create a styled HTML TABLE with <table>/<th>/<td>. Cards = FAILURE.

CSS:
.content { flex:1; display:flex; flex-direction:column; }
table { width:100%; border-collapse:separate; border-spacing:0; border-radius:12px; overflow:hidden; flex:1; }
th { padding:20px 24px; background:${design.primary_color}; color:#fff; font-size:26px; font-weight:700; text-align:left; }
td { padding:20px 24px; font-size:26px; border-bottom:1px solid ${design.accent_light}; color:${design.text_color}; }
tr:nth-child(even) td { background:${design.accent_light}40; }
tr.highlight td { background:${design.accent_color}15; font-weight:600; }
.summary-bar { margin-top:auto; padding:20px 24px; background:${design.accent_light}; border-radius:12px; font-size:26px; color:${design.text_color}; }

⚠ table uses flex:1 to stretch vertically. Use larger padding on td (28-32px) if fewer rows to fill space.
⚠ Header: dark ${design.primary_color} background with WHITE text. 6-8 rows × 3-5 columns. EVERY cell real data.
⚠ Add .summary-bar below table with margin-top:auto to anchor it at the bottom and fill remaining space.
⚠⚠⚠ <table> and .summary-bar MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    process_flow: `═══ REQUIRED LAYOUT: PROCESS FLOW ═══
⚠⚠⚠ You MUST create a HORIZONTAL PROCESS FLOW with step boxes + arrows (→). Cards without arrows = FAILURE.

CSS:
.content { flex:1; display:flex; align-items:stretch; gap:0; }
.step { flex:1; display:flex; flex-direction:column; align-items:center; padding:32px 20px; background:${design.accent_light}; border-radius:16px; text-align:center; gap:16px; }
.step-number { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, ${design.primary_color}, ${design.gradient_end}); color:#fff; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; flex-shrink:0; }
.step-title { font-size:28px; font-weight:700; color:${design.primary_color}; }
.step-desc { font-size:24px; color:${design.text_color}; line-height:1.5; flex:1; }
.step-time { font-size:24px; color:${design.accent_color}; font-weight:600; margin-top:auto; padding-top:12px; border-top:2px solid ${design.accent_color}40; }
.arrow { width:60px; display:flex; align-items:center; justify-content:center; font-size:44px; color:${design.accent_color}; flex-shrink:0; }

CRITICAL PATTERN — your .content MUST alternate .step and .arrow divs:
<div class="content">
  <div class="step">
    <div class="step-number">1</div>
    <div class="step-title">STEP TITLE</div>
    <div class="step-desc">Description text</div>
    <div class="step-time">Duration/detail</div>
  </div>
  <div class="arrow">→</div>
  <div class="step">...</div>
  <div class="arrow">→</div>
  <div class="step">...</div>
</div>

⚠ 3-5 steps with → arrows between them. align-items:stretch makes all steps equal height.
⚠ .step-time with margin-top:auto anchors it at the bottom of each step.
⚠⚠⚠ .step and .arrow divs MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    big_numbers: `═══ REQUIRED LAYOUT: BIG NUMBER METRICS ═══
⚠⚠⚠ You MUST create BIG NUMBER SPOTLIGHT cards with 72-96px numbers. Tables/small text = FAILURE.

CSS:
.content { flex:1; display:flex; gap:40px; align-items:stretch; }
.metric-card { flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:48px 32px; border-radius:20px; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,0.06); text-align:center; gap:20px; }
.metric-value { font-size:80px; font-weight:800; color:${design.primary_color}; line-height:1; }
.metric-unit { font-size:32px; font-weight:600; color:${design.accent_color}; }
.metric-label { font-size:28px; font-weight:600; color:${design.text_color}; }
.metric-desc { font-size:24px; color:${design.text_color}aa; line-height:1.5; }
.metric-trend { font-size:26px; font-weight:600; margin-top:auto; }

⚠ 2-3 metric cards side by side. Each: huge number (font-size:80px), unit, label, description, trend.
⚠ align-items:stretch makes cards fill full height. justify-content:center within each card centers content.
⚠ Trend colors: green (#10B981) for positive ▲, red (#EF4444) for negative ▼.
⚠⚠⚠ .metric-card divs MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    two_col_split: `═══ REQUIRED LAYOUT: 2-COLUMN SPLIT ═══
⚠⚠⚠ You MUST create a 2-COLUMN layout. Single column = FAILURE.

CSS:
.content { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:32px; }
.left-col { display:flex; flex-direction:column; gap:20px; justify-content:center; padding:20px; }
.right-col { display:flex; flex-direction:column; gap:20px; justify-content:center; padding:20px; }

⚠ Left column: primary content (big metric, chart, or main visual). Right: supporting detail cards or text.
⚠ Both columns stretch full height. Keep text LARGE (28-32px) — don't try to squeeze too much.
⚠ MAX 3-4 items per column. If content overflows, reduce items instead of shrinking text.`,

    timeline: `═══ REQUIRED LAYOUT: TIMELINE ═══
⚠⚠⚠ You MUST create a HORIZONTAL TIMELINE with milestone cards. Generic cards = FAILURE.

CSS:
.content { flex:1; display:flex; align-items:stretch; gap:24px; }
.milestone { flex:1; display:flex; flex-direction:column; padding:32px; border-radius:16px; background:#fff; box-shadow:0 4px 20px rgba(0,0,0,0.06); gap:16px; }
.milestone-date { font-size:24px; font-weight:700; color:${design.accent_color}; }
.milestone-icon { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, ${design.primary_color}, ${design.gradient_end}); display:flex; align-items:center; justify-content:center; color:#fff; font-size:24px; }
.milestone-title { font-size:30px; font-weight:700; color:${design.primary_color}; }
.milestone-desc { font-size:26px; color:${design.text_color}; line-height:1.5; flex:1; }
.milestone-kpi { font-size:24px; font-weight:600; color:${design.accent_color}; margin-top:auto; padding-top:16px; border-top:2px solid ${design.accent_light}; }

⚠ 3-4 .milestone cards side by side. Each: date → icon → title → description → KPI at bottom.
⚠ align-items:stretch + flex:1 on .milestone-desc ensures all cards are equal height.
⚠ .milestone-kpi with margin-top:auto anchors it at the bottom of each card.
⚠⚠⚠ .milestone divs MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    progress_bars: `═══ REQUIRED LAYOUT: PROGRESS BARS ═══
⚠⚠⚠ You MUST create FULL-WIDTH HORIZONTAL PROGRESS BARS. Small bars inside cards = FAILURE.

CSS:
.content { flex:1; display:flex; flex-direction:column; justify-content:space-evenly; gap:0; padding:20px 0; }
.bar-item { display:flex; flex-direction:column; gap:10px; }
.bar-header { display:flex; justify-content:space-between; align-items:baseline; }
.bar-label { font-size:28px; font-weight:600; color:${design.text_color}; }
.bar-value { font-size:28px; font-weight:700; color:${design.primary_color}; }
.bar-track { width:100%; height:44px; background:${design.accent_light}; border-radius:22px; overflow:hidden; }
.bar-fill { height:100%; border-radius:22px; background:linear-gradient(90deg, ${design.primary_color}, ${design.accent_color}); }

CRITICAL PATTERN — your .content MUST be a vertical stack of .bar-item divs:
<div class="content">
  <div class="bar-item">
    <div class="bar-header">
      <span class="bar-label">Category Name</span>
      <span class="bar-value">85%</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:85%"></div></div>
  </div>
  <!-- repeat 4-6 bar-items -->
</div>

⚠ justify-content:space-evenly distributes bars across the full height — NO empty bottom.
⚠ Each bar: header row (label + percentage) + track div containing fill div with style="width:XX%".
⚠ 4-5 bars (MAX 5). Bar height:44px. Use gradient fills. Labels under 15 chars. The structure above is non-negotiable.
⚠⚠⚠ .bar-item divs MUST be DIRECT children of .content. Do NOT wrap them in a container div.`,

    hero_stat: `═══ REQUIRED LAYOUT: HERO STAT ═══
⚠⚠⚠ You MUST create a SINGLE LARGE CENTRAL METRIC. Cards/tables = FAILURE.

CSS:
.content { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px; }
.hero-number { font-size:128px; font-weight:900; color:${design.primary_color}; line-height:1; }
.hero-unit { font-size:48px; font-weight:600; color:${design.accent_color}; }
.hero-label { font-size:36px; font-weight:600; color:${design.text_color}; }
.hero-context { font-size:28px; color:${design.text_color}aa; text-align:center; max-width:800px; line-height:1.6; }
.supporting-row { display:flex; gap:60px; margin-top:48px; }
.supporting-item { text-align:center; }
.supporting-value { font-size:40px; font-weight:700; color:${design.primary_color}; }
.supporting-label { font-size:24px; color:${design.text_color}aa; margin-top:8px; }

⚠ ONE giant number (font-size:128px) center stage. Description below. Optional 2-3 supporting metrics in a row.
⚠ This is the ONLY layout where justify-content:center on .content is correct.`,
  };

  return layouts[layoutType] || layouts.cards;
}

// =============================================================================
// Post-processing & Review (kept from original)
// =============================================================================

/**
 * Post-process generated HTML to inject CSS fixes for common issues.
 * Preserves LLM's creative choices while fixing fill rate, sizing, and stretching.
 */
export function postProcessSlideHtml(html: string): string {
  const fixStyle = `<style id="viewport-fill">
body{display:flex!important;flex-direction:column!important;height:1080px!important;min-height:1080px!important;overflow:hidden!important;font-size:max(26px,1.35vw)}
body>*:first-child{flex:0 0 auto!important}
body>*:not(:first-child):not(style):not(script){flex:1 1 0!important;min-height:0!important;align-content:stretch!important;align-items:stretch!important}
body>*:not(:first-child):not(style):not(script)>*{align-self:stretch!important;min-height:0}
.slide-title{flex:0 0 auto!important}
.content{flex:1 1 0!important;min-height:0!important;align-content:stretch!important;align-items:stretch!important}
.content>*{align-self:stretch!important;min-height:0}
.content>:only-child{display:flex!important;flex-direction:column!important;justify-content:space-evenly!important;flex:1 1 0!important;min-height:0!important}
</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', fixStyle + '</head>');
  }
  if (html.includes('</style>')) {
    return html.replace(/<\/style>(?![\s\S]*<\/style>)/, fixStyle + '</style>');
  }
  return html;
}

/**
 * Build a review prompt to evaluate generated HTML against expected layout.
 */
export function buildReviewPrompt(
  html: string,
  expectedLayout: LayoutType,
  slideTitle: string,
): string {
  return `You are a presentation slide quality reviewer. Evaluate this HTML slide and output ONLY a JSON object.

EXPECTED LAYOUT: "${expectedLayout}"
SLIDE TITLE: "${slideTitle}"

HTML (first 3000 chars):
${html.slice(0, 3000)}

Evaluate:
1. LAYOUT (1-10): Does it use "${expectedLayout}" layout? Wrong layout type = score 1.
2. READABILITY (1-10): Font sizes ≥26px? Good contrast? Text readable?
3. FILL (1-10): Content fills 80-90% of 1920×1080? No huge empty areas?

Output JSON ONLY (no markdown fences):
{"layout":N,"readability":N,"fill":N,"pass":true/false,"feedback":"specific fix needed or empty string"}

PASS = all scores ≥ 7. FAIL = any score < 7.`;
}

// =============================================================================
// Legacy Prompts — Kept for SubAgent Fallback
// =============================================================================

export const PPT_CREATE_SYSTEM_PROMPT = `You are an elite PowerPoint presentation creator.
You build NEW presentations using high-level layout builder tools.
Each tool call creates ONE complete, professionally-designed slide.

═══ AVAILABLE TOOLS ═══
Lifecycle: powerpoint_create, powerpoint_save
Slides: ppt_build_title_slide, ppt_build_layout_a, ppt_build_layout_b, ppt_build_layout_c, ppt_build_layout_d, ppt_build_layout_e, ppt_build_layout_f, ppt_build_closing_slide
Chart: powerpoint_add_chart (use sparingly — prefer Layout D or F for data)
Complete: complete (call AFTER saving)

═══ WORKFLOW ═══
1. powerpoint_create — launch PowerPoint
2. ppt_build_title_slide — first slide
3. ppt_build_layout_[a-f] — content slides (one tool call per slide)
4. ppt_build_closing_slide — MUST be the absolute LAST content slide
5. powerpoint_save — save file
6. complete — report summary

═══ CONTENT QUALITY ═══
• ALL text MUST be in the same language as the user's instruction
• Korean input → Korean titles, bullets, table headers, everything
• NEVER use placeholder text like "[]", "XXX", "lorem ipsum"
• Generate REAL, specific, professional content with concrete data

═══ RULES ═══
1. Build each slide COMPLETELY with one tool call before moving to the next
2. NEVER go back to modify a previous slide
3. NEVER use HTML tags in text — use \\n for line breaks
4. The LAST tool before "complete" MUST be powerpoint_save
5. If save fails with path error, try "C:\\\\temp\\\\presentation.pptx"`;

export const PPT_CREATE_PLANNING_PROMPT = `You are a presentation structure planner.
Given the user's instruction and CREATIVE GUIDANCE, create the execution plan.

⚠ LANGUAGE RULE: ALL slide titles and content MUST be in the SAME language as the user's instruction.

OUTPUT FORMAT:
MODE: CREATE
DESIGN DECISIONS:
- COLOR_SCHEME: [MODERN_TECH, WARM_EXECUTIVE, CLEAN_MINIMAL, CORPORATE, NATURE_FRESH, BOLD_MODERN]
- DESIGN_STYLE: [sidebar / top_band / clean]
TOTAL_SLIDES: [number]
SLIDE_PLAN:
- Slide 1: [Title] | Tool: ppt_build_title_slide | Subtitle: [text]
- Slide N: [Title] | Tool: [tool name] | Content: [summary]`;

// Legacy per-slide prompt builder (for SubAgent fallback)
export function buildSlideSystemPrompt(
  toolName: string,
  title: string,
  direction: string,
  guidance: string,
  language: 'ko' | 'en'
): string {
  if (!toolName.startsWith('ppt_build_layout_')) return '';

  const langRule = language === 'ko'
    ? 'ALL text MUST be in Korean.'
    : 'ALL text MUST be in English.';

  return `You are building slide "${title}" for a PowerPoint presentation.
You have exactly ONE tool available. Call it with the correct parameters.

═══ CONTENT DIRECTION ═══
${direction}

═══ CREATIVE CONTEXT ═══
${guidance}

═══ RULES ═══
• ${langRule}
• Generate REAL, specific, professional content with concrete data
• NEVER use placeholder text
• Call the tool EXACTLY ONCE with all required parameters`;
}
