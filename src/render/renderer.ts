import { resolve } from 'node:path';
// pptxgenjs has an awkward type shape — its runtime export is a class but
// tsc reads the `export as namespace` + `export default` combo as a namespace.
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs constructor typing workaround
import pptxgenjsImport from 'pptxgenjs';
// biome-ignore lint/suspicious/noExplicitAny: see above
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

import type { Slide, SlidePlan, Bullet, Column } from '../deck/schema.js';
import { DEFAULT_THEME, type Theme, SLIDE_W, SLIDE_H, SIDE_MARGIN } from '../deck/theme.js';

/**
 * Render a validated SlidePlan to a `.pptx` file on disk.
 *
 * Design philosophy: generous whitespace, tight type hierarchy, one accent
 * colour, consistent layout decisions across the deck. The renderer is
 * deterministic — no LLM at this layer. The LLM's job is to produce a good
 * plan; this layer's job is to make any plan look as good as possible.
 */
export async function renderPlan(plan: SlidePlan, outPath: string): Promise<string> {
  const pres = new PptxGenJS();
  pres.layout = plan.meta.aspect === '4:3' ? 'LAYOUT_STANDARD' : 'LAYOUT_WIDE';
  pres.title = plan.meta.title;
  if (plan.meta.author) pres.author = plan.meta.author;

  const theme = mergeTheme(plan.theme);
  const total = plan.slides.length;
  // First slide is the title — never gets a footer. Section slides also
  // skip the footer for visual breathing room.
  plan.slides.forEach((slide, idx) => {
    const s = pres.addSlide();
    s.background = { color: slide.layout === 'section' ? theme.accent : theme.paper };
    renderSlide(s, slide, theme);
    s.addNotes(slide.notes ?? '');
    if (slide.layout !== 'section' && slide.layout !== 'title' && idx > 0) {
      drawFooter(s, theme, idx + 1, total, plan.meta.title);
    }
  });

  const abs = resolve(process.cwd(), outPath);
  await pres.writeFile({ fileName: abs });
  return abs;
}

function mergeTheme(override?: SlidePlan['theme']): Theme {
  return {
    ...DEFAULT_THEME,
    ...(override?.accent ? { accent: override.accent } : {}),
    ...(override?.ink ? { ink: override.ink } : {}),
    ...(override?.muted ? { muted: override.muted } : {}),
    ...(override?.paper ? { paper: override.paper } : {}),
    ...(override?.fontHeading ? { fontHeading: override.fontHeading } : {}),
    ...(override?.fontBody ? { fontBody: override.fontBody } : {}),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderSlide(s: any, slide: Slide, theme: Theme): void {
  switch (slide.layout) {
    case 'title':
      return renderTitle(s, slide, theme);
    case 'content':
      return renderContent(s, slide, theme);
    case 'two-col':
      return renderTwoCol(s, slide, theme);
    case 'section':
      return renderSection(s, slide, theme);
    case 'quote':
      return renderQuote(s, slide, theme);
    case 'closing':
      return renderClosing(s, slide, theme);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderTitle(s: any, slide: Extract<Slide, { layout: 'title' }>, theme: Theme) {
  // Thin accent strip above the title — anchors the eye, signals brand.
  s.addShape('rect', {
    x: SIDE_MARGIN,
    y: 2.6,
    w: 1.4,
    h: 0.08,
    fill: { color: theme.accent },
    line: { type: 'none' },
  });
  s.addText(slide.title, {
    x: SIDE_MARGIN,
    y: 2.9,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: 1.6,
    fontFace: theme.fontHeading,
    fontSize: 60,
    bold: true,
    color: theme.ink,
    align: 'left',
    valign: 'top',
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: SIDE_MARGIN,
      y: 4.4,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.9,
      fontFace: theme.fontBody,
      fontSize: 24,
      color: theme.muted,
      align: 'left',
      valign: 'top',
    });
  }
  // Author + date pinned to the bottom for a clean, designed feel.
  const footerLine = [slide.author, slide.date].filter(Boolean).join('  ·  ');
  if (footerLine) {
    s.addText(footerLine, {
      x: SIDE_MARGIN,
      y: SLIDE_H - 0.9,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.4,
      fontFace: theme.fontBody,
      fontSize: 14,
      color: theme.muted,
      align: 'left',
    });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderContent(s: any, slide: Extract<Slide, { layout: 'content' }>, theme: Theme) {
  drawAccentStrip(s, theme);
  s.addText(slide.title, {
    x: SIDE_MARGIN,
    y: 0.55,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: 0.9,
    fontFace: theme.fontHeading,
    fontSize: 32,
    bold: true,
    color: theme.ink,
    align: 'left',
    valign: 'top',
  });
  let cursorY = 1.45;
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: SIDE_MARGIN,
      y: cursorY,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.55,
      fontFace: theme.fontBody,
      fontSize: 18,
      color: theme.muted,
      align: 'left',
      valign: 'top',
    });
    cursorY += 0.6;
  }
  s.addText(bulletsToTextProps(slide.body, theme), {
    x: SIDE_MARGIN,
    y: cursorY + 0.2,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: SLIDE_H - cursorY - 1.0,
    fontFace: theme.fontBody,
    fontSize: 22,
    color: theme.ink,
    valign: 'top',
    paraSpaceAfter: 8,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderTwoCol(s: any, slide: Extract<Slide, { layout: 'two-col' }>, theme: Theme) {
  drawAccentStrip(s, theme);
  s.addText(slide.title, {
    x: SIDE_MARGIN,
    y: 0.55,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: 0.9,
    fontFace: theme.fontHeading,
    fontSize: 32,
    bold: true,
    color: theme.ink,
    align: 'left',
    valign: 'top',
  });
  let bodyTop = 1.5;
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: SIDE_MARGIN,
      y: bodyTop,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.55,
      fontFace: theme.fontBody,
      fontSize: 18,
      color: theme.muted,
      align: 'left',
      valign: 'top',
    });
    bodyTop += 0.6;
  }
  const colGap = 0.6;
  const colW = (SLIDE_W - SIDE_MARGIN * 2 - colGap) / 2;
  const colH = SLIDE_H - bodyTop - 1.0;
  // Subtle vertical divider between columns.
  s.addShape('line', {
    x: SIDE_MARGIN + colW + colGap / 2,
    y: bodyTop + 0.1,
    w: 0,
    h: colH - 0.2,
    line: { color: theme.muted, width: 0.5, transparency: 60 },
  });
  drawColumn(s, slide.left, theme, SIDE_MARGIN, bodyTop, colW, colH);
  drawColumn(s, slide.right, theme, SIDE_MARGIN + colW + colGap, bodyTop, colW, colH);
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function drawColumn(s: any, col: Column, theme: Theme, x: number, y: number, w: number, h: number) {
  let textY = y;
  if (col.heading) {
    s.addText(col.heading, {
      x,
      y,
      w,
      h: 0.5,
      fontFace: theme.fontHeading,
      fontSize: 18,
      bold: true,
      color: theme.accent,
      align: 'left',
      valign: 'top',
    });
    textY += 0.55;
  }
  s.addText(bulletsToTextProps(col.body, theme), {
    x,
    y: textY,
    w,
    h: h - (textY - y),
    fontFace: theme.fontBody,
    fontSize: 18,
    color: theme.ink,
    valign: 'top',
    paraSpaceAfter: 6,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderSection(s: any, slide: Extract<Slide, { layout: 'section' }>, theme: Theme) {
  // Background is already the accent (set by caller). All text is paper-coloured.
  if (slide.number) {
    s.addText(slide.number, {
      x: SIDE_MARGIN,
      y: 2.1,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.8,
      fontFace: theme.fontHeading,
      fontSize: 28,
      bold: true,
      color: theme.paper,
      align: 'left',
      transparency: 30,
    });
  }
  s.addText(slide.title, {
    x: SIDE_MARGIN,
    y: 2.9,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: 2.6,
    fontFace: theme.fontHeading,
    fontSize: 64,
    bold: true,
    color: theme.paper,
    align: 'left',
    valign: 'top',
  });
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderQuote(s: any, slide: Extract<Slide, { layout: 'quote' }>, theme: Theme) {
  // Oversized accent glyph as a graphic cue.
  s.addText('“', {
    x: SIDE_MARGIN,
    y: 0.4,
    w: 2.5,
    h: 2.5,
    fontFace: theme.fontHeading,
    fontSize: 200,
    bold: true,
    color: theme.accent,
    align: 'left',
    valign: 'top',
  });
  s.addText(slide.quote, {
    x: SIDE_MARGIN + 0.4,
    y: 2.3,
    w: SLIDE_W - SIDE_MARGIN * 2 - 0.4,
    h: 3.4,
    fontFace: theme.fontHeading,
    fontSize: 36,
    italic: true,
    color: theme.ink,
    align: 'left',
    valign: 'top',
  });
  if (slide.attribution) {
    s.addText(`— ${slide.attribution}`, {
      x: SIDE_MARGIN + 0.4,
      y: SLIDE_H - 1.4,
      w: SLIDE_W - SIDE_MARGIN * 2 - 0.4,
      h: 0.5,
      fontFace: theme.fontBody,
      fontSize: 18,
      color: theme.muted,
      align: 'left',
    });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function renderClosing(s: any, slide: Extract<Slide, { layout: 'closing' }>, theme: Theme) {
  s.background = { color: theme.accent };
  s.addText(slide.title, {
    x: SIDE_MARGIN,
    y: SLIDE_H / 2 - 1.1,
    w: SLIDE_W - SIDE_MARGIN * 2,
    h: 1.4,
    fontFace: theme.fontHeading,
    fontSize: 72,
    bold: true,
    color: theme.paper,
    align: 'center',
    valign: 'middle',
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: SIDE_MARGIN,
      y: SLIDE_H / 2 + 0.4,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.7,
      fontFace: theme.fontBody,
      fontSize: 22,
      color: theme.paper,
      align: 'center',
      transparency: 15,
    });
  }
  if (slide.contact) {
    s.addText(slide.contact, {
      x: SIDE_MARGIN,
      y: SLIDE_H - 1.0,
      w: SLIDE_W - SIDE_MARGIN * 2,
      h: 0.5,
      fontFace: theme.fontBody,
      fontSize: 16,
      color: theme.paper,
      align: 'center',
      transparency: 25,
    });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function drawAccentStrip(s: any, theme: Theme) {
  // Slim accent bar at the top-left — a brand consistency cue that runs
  // across all content slides. Mind the proportions: short, not chunky.
  s.addShape('rect', {
    x: SIDE_MARGIN,
    y: 0.32,
    w: 0.9,
    h: 0.06,
    fill: { color: theme.accent },
    line: { type: 'none' },
  });
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type
function drawFooter(s: any, theme: Theme, page: number, total: number, deckTitle: string) {
  // Left: muted deck title. Right: page x of y. Both tiny — they shouldn't
  // compete with content.
  s.addText(deckTitle, {
    x: SIDE_MARGIN,
    y: SLIDE_H - 0.45,
    w: 6,
    h: 0.3,
    fontFace: theme.fontBody,
    fontSize: 10,
    color: theme.muted,
    align: 'left',
  });
  s.addText(`${page} / ${total}`, {
    x: SLIDE_W - SIDE_MARGIN - 2,
    y: SLIDE_H - 0.45,
    w: 2,
    h: 0.3,
    fontFace: theme.fontBody,
    fontSize: 10,
    color: theme.muted,
    align: 'right',
  });
}

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs TextProps[]
function bulletsToTextProps(bullets: Bullet[], theme: Theme): any[] {
  return bullets.map((b) => ({
    text: b.text,
    options: {
      bullet: {
        indent: b.level === 1 ? 28 : 18,
        // Level-0 bullets get the accent colour for a subtle visual rhythm;
        // level-1 bullets get the muted colour to recede.
        // pptxgenjs allows a coloured bullet via the parent run's color, but
        // for fine control we keep the bullet text uncoloured and let the run
        // colour speak.
      },
      indentLevel: b.level,
      color: b.level === 1 ? theme.muted : theme.ink,
    },
  }));
}
