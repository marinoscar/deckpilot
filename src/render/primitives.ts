/**
 * Design primitives — small, focused functions that each draw one piece of
 * the DeckPilot visual language using pptxgenjs shapes. Composed by
 * `composition.ts` into full slides.
 *
 * Each primitive accepts the pptxgenjs `slide` object plus simple geometry
 * and palette arguments. Primitives MUST NOT share option-object references
 * across shape calls — pptxgenjs mutates them in place. Every `addShape` /
 * `addText` call gets a fresh literal.
 *
 * Colours are passed as bare 6-digit hex (no leading #), matching the
 * `DesignSystem` schema. Coordinates are in inches against the 13.333" × 7.5"
 * 16:9 slide.
 */

import type { DesignSystem, Glyph } from '../deck/schema.js';

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs Slide type is awkward; we treat it opaquely.
export type Slide = any;

// ---------- shared constants ----------

export const SIDE_BAR_W = 0.1; // width of the vertical accent strip on cards
export const TOP_BAR_H = 0.1; // height of the horizontal accent strip on cards
export const CARD_RADIUS = 0.06; // inches of corner rounding on cards/pills
export const PILL_RADIUS = 0.18; // pills are more rounded than cards

const SHADOW_SOFT = (): Record<string, unknown> => ({
  type: 'outer',
  color: '000000',
  blur: 6,
  offset: 2,
  angle: 135,
  opacity: 0.1,
});

const SHADOW_MEDIUM = (): Record<string, unknown> => ({
  type: 'outer',
  color: '000000',
  blur: 8,
  offset: 3,
  angle: 135,
  opacity: 0.14,
});

// ---------- card ----------

export type CardOpts = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hex (no #) for the accent strip / accent details on this card. */
  accentHex: string;
  /** Optional pale fill behind the card content. */
  tintHex?: string;
  /** Where the accent strip goes; 'plain' = no strip. */
  style?: 'side-bar' | 'top-bar' | 'plain';
  /** Drop-shadow intensity. Default 'soft'. */
  shadow?: 'none' | 'soft' | 'medium';
};

/**
 * Card container — rounded background rectangle with an optional accent strip
 * along the left edge (side-bar, the image-1 look) or top edge (top-bar, the
 * image-2 look). The card's content is drawn separately by the caller; this
 * primitive only draws the chrome.
 */
export function drawCard(slide: Slide, opts: CardOpts): void {
  const style = opts.style ?? 'side-bar';
  const shadowKind = opts.shadow ?? 'soft';

  // 1) Background — rounded rect with tint fill and optional drop shadow.
  slide.addShape('roundRect', {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    rectRadius: CARD_RADIUS,
    fill: opts.tintHex ? { color: opts.tintHex } : { color: 'FFFFFF' },
    line: { type: 'none' },
    ...(shadowKind === 'none' ? {} : { shadow: shadowKind === 'medium' ? SHADOW_MEDIUM() : SHADOW_SOFT() }),
  });

  // 2) Accent strip
  if (style === 'side-bar') {
    slide.addShape('rect', {
      x: opts.x,
      y: opts.y,
      w: SIDE_BAR_W,
      h: opts.h,
      fill: { color: opts.accentHex },
      line: { type: 'none' },
    });
  } else if (style === 'top-bar') {
    slide.addShape('rect', {
      x: opts.x,
      y: opts.y,
      w: opts.w,
      h: TOP_BAR_H,
      fill: { color: opts.accentHex },
      line: { type: 'none' },
    });
  }
}

// ---------- kicker ----------

export type KickerOpts = {
  x: number;
  y: number;
  w?: number;
  text: string;
  accentHex: string;
  fontFace: string;
  /** Small accent line drawn above (or before) the text. */
  withRule?: boolean;
};

/**
 * Kicker — the small all-caps letter-spaced label used to signpost a section,
 * card, or slide ("IN PLAIN ENGLISH", "STAGE 1", "SEMANTIC MODEL"). Optionally
 * preceded by a short coloured rule (image 1 has them; image 3 has them).
 */
export function drawKicker(slide: Slide, opts: KickerOpts): void {
  const w = opts.w ?? 6;
  if (opts.withRule !== false) {
    // Short horizontal rule on the left, ~0.4" wide
    slide.addShape('rect', {
      x: opts.x,
      y: opts.y + 0.07,
      w: 0.3,
      h: 0.04,
      fill: { color: opts.accentHex },
      line: { type: 'none' },
    });
  }
  slide.addText(opts.text.toUpperCase(), {
    x: opts.withRule !== false ? opts.x + 0.45 : opts.x,
    y: opts.y,
    w,
    h: 0.3,
    fontFace: opts.fontFace,
    fontSize: 11,
    bold: true,
    color: opts.accentHex,
    charSpacing: 4,
    align: 'left',
    valign: 'middle',
  });
}

// ---------- numbered circle / pill ----------

export type NumberedOpts = {
  x: number;
  y: number;
  size: number; // diameter in inches
  label: string; // "01", "1", "I"
  accentHex: string;
  fillHex?: string; // background fill (defaults to white)
  style?: 'circle' | 'pill';
  fontFace: string;
};

/**
 * Numbered badge — the "01" / "02" / "03" circles from image 2. Renders as
 * either a true circle (oval with equal w/h) or a wider pill. The number
 * itself is drawn in the accent colour on a pale background.
 */
export function drawNumberedBadge(slide: Slide, opts: NumberedOpts): void {
  const style = opts.style ?? 'circle';
  const w = style === 'circle' ? opts.size : opts.size * 1.6;
  const fill = opts.fillHex ?? 'FFFFFF';
  // Soft accent ring effect: a slightly larger circle in pale accent behind.
  const ringInset = 0.02;
  slide.addShape(style === 'circle' ? 'ellipse' : 'roundRect', {
    x: opts.x - ringInset,
    y: opts.y - ringInset,
    w: w + ringInset * 2,
    h: opts.size + ringInset * 2,
    rectRadius: opts.size,
    fill: { color: opts.accentHex, transparency: 80 },
    line: { type: 'none' },
  });
  slide.addShape(style === 'circle' ? 'ellipse' : 'roundRect', {
    x: opts.x,
    y: opts.y,
    w,
    h: opts.size,
    rectRadius: opts.size,
    fill: { color: fill },
    line: { color: opts.accentHex, width: 1.2 },
  });
  slide.addText(opts.label, {
    x: opts.x,
    y: opts.y,
    w,
    h: opts.size,
    fontFace: opts.fontFace,
    fontSize: opts.size > 0.7 ? 16 : 14,
    bold: true,
    color: opts.accentHex,
    align: 'center',
    valign: 'middle',
  });
}

// ---------- CTA pill ----------

export type CtaPillOpts = {
  x: number;
  y: number;
  w: number;
  h?: number; // default 0.45
  text: string;
  accentHex: string;
  textColor?: string; // default white
  fontFace: string;
};

/**
 * CTA pill — the filled rounded rectangle at the bottom of cards in image 1
 * ("LETS YOU → SEARCH"). Solid accent fill, white all-caps text, generous
 * letter-spacing.
 */
export function drawCtaPill(slide: Slide, opts: CtaPillOpts): void {
  const h = opts.h ?? 0.45;
  slide.addShape('roundRect', {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h,
    rectRadius: PILL_RADIUS,
    fill: { color: opts.accentHex },
    line: { type: 'none' },
  });
  slide.addText(opts.text.toUpperCase(), {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h,
    fontFace: opts.fontFace,
    fontSize: 11,
    bold: true,
    color: opts.textColor ?? 'FFFFFF',
    align: 'center',
    valign: 'middle',
    charSpacing: 6,
  });
}

// ---------- footer band ----------

export type FooterBandOpts = {
  /** Slide width. */
  slideW: number;
  /** Slide height. */
  slideH: number;
  deckTitle: string;
  section?: string;
  page: number;
  total: number;
  theme: DesignSystem;
};

/**
 * Footer band — the bottom strip with "Deck title  |  Section" on the left,
 * "page / total" on the right, separated by a thin accent rule above. Image
 * 1, 2, 3 all have this. Designed to be barely-there but consistent.
 */
export function drawFooterBand(slide: Slide, opts: FooterBandOpts): void {
  const margin = 0.6;
  const baseY = opts.slideH - 0.5;

  // Thin coloured rule above the footer text
  slide.addShape('rect', {
    x: margin,
    y: baseY - 0.08,
    w: opts.slideW - margin * 2,
    h: 0.03,
    fill: { color: opts.theme.accentAlt },
    line: { type: 'none' },
  });

  // Left side: deck title  |  section
  const leftText = opts.section
    ? `${opts.deckTitle}  |  ${opts.section}`
    : opts.deckTitle;
  slide.addText(leftText, {
    x: margin,
    y: baseY,
    w: opts.slideW - margin * 2 - 1.5,
    h: 0.3,
    fontFace: opts.theme.fontBody,
    fontSize: 10,
    color: opts.theme.muted,
    align: 'left',
    valign: 'middle',
  });

  // Right side: page / total
  slide.addText(`${opts.page} / ${opts.total}`, {
    x: opts.slideW - margin - 1.5,
    y: baseY,
    w: 1.5,
    h: 0.3,
    fontFace: opts.theme.fontBody,
    fontSize: 10,
    color: opts.theme.muted,
    align: 'right',
    valign: 'middle',
  });
}

// ---------- callout bar ----------

export type CalloutBarOpts = {
  /** Slide width. */
  slideW: number;
  /** Y position of the band's top. */
  y: number;
  h?: number; // default 0.7
  statement: string;
  lead?: string; // optional "Bottom line:" prefix style
  theme: DesignSystem;
  /** Which accent supplies the left edge. */
  edgeAccent?: 'primary' | 'alt';
};

/**
 * Callout bar — the full-width dark band at the bottom of image 2 with the
 * red left edge ("Bottom line: every enterprise needs semantic models …").
 * Dark navy background, accent-colored left edge, light text.
 */
export function drawCalloutBar(slide: Slide, opts: CalloutBarOpts): void {
  const margin = 0.6;
  const h = opts.h ?? 0.7;
  const edge = opts.edgeAccent === 'alt' ? opts.theme.accentAlt : opts.theme.accent;
  const bg = '0F1B3C'; // deep navy used in image 2

  // Main dark band
  slide.addShape('rect', {
    x: margin,
    y: opts.y,
    w: opts.slideW - margin * 2,
    h,
    fill: { color: bg },
    line: { type: 'none' },
  });
  // Accent edge on the left
  slide.addShape('rect', {
    x: margin,
    y: opts.y,
    w: 0.1,
    h,
    fill: { color: edge },
    line: { type: 'none' },
  });

  // Text — bold lead on the left of the statement
  const textX = margin + 0.35;
  const textW = opts.slideW - margin * 2 - 0.5;
  if (opts.lead) {
    slide.addText(
      [
        { text: `${opts.lead}: `, options: { bold: true, color: opts.theme.accentAlt } },
        { text: opts.statement, options: { color: 'FFFFFF' } },
      ],
      {
        x: textX,
        y: opts.y,
        w: textW,
        h,
        fontFace: opts.theme.fontBody,
        fontSize: 14,
        align: 'left',
        valign: 'middle',
      },
    );
  } else {
    slide.addText(opts.statement, {
      x: textX,
      y: opts.y,
      w: textW,
      h,
      fontFace: opts.theme.fontBody,
      fontSize: 14,
      color: 'FFFFFF',
      align: 'left',
      valign: 'middle',
    });
  }
}

// ---------- corner accent ----------

export type CornerAccentOpts = {
  slideW: number;
  slideH: number;
  corner: 'tl' | 'tr' | 'bl' | 'br';
  size?: number;
  color: string;
};

/** Tiny decorative dot in a slide corner. Used sparingly. */
export function drawCornerAccent(slide: Slide, opts: CornerAccentOpts): void {
  const size = opts.size ?? 0.18;
  const margin = 0.3;
  let x = 0;
  let y = 0;
  switch (opts.corner) {
    case 'tl':
      x = margin;
      y = margin;
      break;
    case 'tr':
      x = opts.slideW - margin - size;
      y = margin;
      break;
    case 'bl':
      x = margin;
      y = opts.slideH - margin - size;
      break;
    case 'br':
      x = opts.slideW - margin - size;
      y = opts.slideH - margin - size;
      break;
  }
  slide.addShape('ellipse', {
    x,
    y,
    w: size,
    h: size,
    fill: { color: opts.color, transparency: 35 },
    line: { type: 'none' },
  });
}

// ---------- glyphs ----------

export type GlyphOpts = {
  x: number;
  y: number;
  w: number;
  h: number;
  accentHex: string;
  mutedHex: string;
};

/**
 * Tiny infographic drawn from primitives. Used inside grid items to give a
 * card a visual hook (image 1's table-rows icon, image 1's network icon,
 * image 3's stage icons). Each glyph is composed of 3-6 shapes.
 */
export function drawGlyph(slide: Slide, kind: Glyph, opts: GlyphOpts): void {
  switch (kind) {
    case 'table':
      drawTableGlyph(slide, opts);
      return;
    case 'network':
      drawNetworkGlyph(slide, opts);
      return;
    case 'equals':
      drawEqualsGlyph(slide, opts);
      return;
    case 'check':
      drawCheckGlyph(slide, opts);
      return;
    case 'cross':
      drawCrossGlyph(slide, opts);
      return;
    case 'spark':
      drawSparkGlyph(slide, opts);
      return;
    case 'bars':
      drawBarsGlyph(slide, opts);
      return;
    case 'pie':
      drawPieGlyph(slide, opts);
      return;
    case 'grid':
      drawGridGlyph(slide, opts);
      return;
    case 'cursor':
      drawCursorGlyph(slide, opts);
      return;
  }
}

function drawTableGlyph(slide: Slide, o: GlyphOpts): void {
  // Container square
  slide.addShape('rect', {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    fill: { type: 'none' },
    line: { color: o.accentHex, width: 1.2 },
  });
  // 4 rows alternating dark / muted
  const rowH = (o.h - 0.08) / 4;
  const startY = o.y + 0.04;
  const colors = [o.accentHex, o.mutedHex, o.accentHex, o.mutedHex];
  for (let i = 0; i < 4; i++) {
    const w = i % 2 === 0 ? o.w * 0.5 : o.w * 0.7;
    slide.addShape('rect', {
      x: o.x + 0.08,
      y: startY + i * rowH + rowH * 0.25,
      w: w - 0.12,
      h: rowH * 0.5,
      fill: { color: colors[i]! },
      line: { type: 'none' },
    });
  }
}

function drawNetworkGlyph(slide: Slide, o: GlyphOpts): void {
  // 5 nodes forming a small connected graph. Coordinates are relative offsets.
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const r = Math.min(o.w, o.h) * 0.4;
  const dot = Math.min(o.w, o.h) * 0.13;
  const nodes = [
    { x: cx, y: cy - r * 0.9 },
    { x: cx + r, y: cy - r * 0.1 },
    { x: cx + r * 0.5, y: cy + r * 0.8 },
    { x: cx - r * 0.7, y: cy + r * 0.4 },
    { x: cx - r * 0.5, y: cy - r * 0.5 },
  ];
  // Lines between adjacent nodes (cycle)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const b = nodes[(i + 1) % nodes.length]!;
    slide.addShape('line', {
      x: a.x,
      y: a.y,
      w: b.x - a.x,
      h: b.y - a.y,
      line: { color: o.accentHex, width: 1.4 },
    });
  }
  // Nodes (dots) on top of lines
  for (const n of nodes) {
    slide.addShape('ellipse', {
      x: n.x - dot / 2,
      y: n.y - dot / 2,
      w: dot,
      h: dot,
      fill: { color: o.accentHex },
      line: { type: 'none' },
    });
  }
}

function drawEqualsGlyph(slide: Slide, o: GlyphOpts): void {
  // Two thick horizontal bars stacked
  const barW = o.w * 0.75;
  const barH = o.h * 0.15;
  const gap = o.h * 0.18;
  const startX = o.x + (o.w - barW) / 2;
  const cy = o.y + o.h / 2;
  slide.addShape('rect', {
    x: startX,
    y: cy - gap / 2 - barH,
    w: barW,
    h: barH,
    fill: { color: o.accentHex },
    line: { type: 'none' },
  });
  slide.addShape('rect', {
    x: startX,
    y: cy + gap / 2,
    w: barW,
    h: barH,
    fill: { color: o.accentHex },
    line: { type: 'none' },
  });
}

function drawCheckGlyph(slide: Slide, o: GlyphOpts): void {
  slide.addText('✓', {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    fontSize: Math.round(o.h * 60),
    bold: true,
    color: o.accentHex,
    align: 'center',
    valign: 'middle',
  });
}

function drawCrossGlyph(slide: Slide, o: GlyphOpts): void {
  slide.addText('✕', {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    fontSize: Math.round(o.h * 60),
    bold: true,
    color: o.accentHex,
    align: 'center',
    valign: 'middle',
  });
}

function drawSparkGlyph(slide: Slide, o: GlyphOpts): void {
  // Up-trending line: three short segments rising left-to-right
  const pts = [
    { x: o.x + o.w * 0.1, y: o.y + o.h * 0.75 },
    { x: o.x + o.w * 0.4, y: o.y + o.h * 0.55 },
    { x: o.x + o.w * 0.7, y: o.y + o.h * 0.4 },
    { x: o.x + o.w * 0.9, y: o.y + o.h * 0.15 },
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    slide.addShape('line', {
      x: a.x,
      y: a.y,
      w: b.x - a.x,
      h: b.y - a.y,
      line: { color: o.accentHex, width: 2.2 },
    });
  }
  // End-point dot
  const end = pts[pts.length - 1]!;
  const r = 0.08;
  slide.addShape('ellipse', {
    x: end.x - r,
    y: end.y - r,
    w: r * 2,
    h: r * 2,
    fill: { color: o.accentHex },
    line: { type: 'none' },
  });
}

function drawBarsGlyph(slide: Slide, o: GlyphOpts): void {
  // 4 ascending bars
  const heights = [0.35, 0.55, 0.75, 1.0];
  const barW = (o.w * 0.7) / heights.length;
  const gap = (o.w * 0.3) / (heights.length + 1);
  const baseY = o.y + o.h * 0.95;
  for (let i = 0; i < heights.length; i++) {
    const h = o.h * 0.8 * heights[i]!;
    const x = o.x + gap + i * (barW + gap);
    slide.addShape('rect', {
      x,
      y: baseY - h,
      w: barW,
      h,
      fill: { color: i === heights.length - 1 ? o.accentHex : o.mutedHex },
      line: { type: 'none' },
    });
  }
}

function drawPieGlyph(slide: Slide, o: GlyphOpts): void {
  // Donut-ish: outer accent ring with a muted inner circle. Approximates a
  // pie chart without needing custom geometry.
  const size = Math.min(o.w, o.h) * 0.9;
  const cx = o.x + o.w / 2 - size / 2;
  const cy = o.y + o.h / 2 - size / 2;
  slide.addShape('ellipse', {
    x: cx,
    y: cy,
    w: size,
    h: size,
    fill: { color: o.accentHex },
    line: { type: 'none' },
  });
  // Cutout wedge — overlay a smaller arc with paper colour to fake a slice.
  // pptxgenjs doesn't support real arcs without custom geometry, so we use
  // an inner muted circle to make it look like a donut.
  const inner = size * 0.45;
  slide.addShape('ellipse', {
    x: cx + (size - inner) / 2,
    y: cy + (size - inner) / 2,
    w: inner,
    h: inner,
    fill: { color: 'FFFFFF' },
    line: { type: 'none' },
  });
  // A thin radial line for visual rhythm
  slide.addShape('line', {
    x: cx + size / 2,
    y: cy,
    w: 0,
    h: size / 2,
    line: { color: 'FFFFFF', width: 2 },
  });
}

function drawGridGlyph(slide: Slide, o: GlyphOpts): void {
  // 2x2 squares with one accent and three muted
  const size = Math.min(o.w, o.h);
  const cellSize = size * 0.42;
  const gap = size * 0.06;
  const startX = o.x + (o.w - (cellSize * 2 + gap)) / 2;
  const startY = o.y + (o.h - (cellSize * 2 + gap)) / 2;
  const cells: { dx: number; dy: number; accent: boolean }[] = [
    { dx: 0, dy: 0, accent: true },
    { dx: cellSize + gap, dy: 0, accent: false },
    { dx: 0, dy: cellSize + gap, accent: false },
    { dx: cellSize + gap, dy: cellSize + gap, accent: false },
  ];
  for (const c of cells) {
    slide.addShape('rect', {
      x: startX + c.dx,
      y: startY + c.dy,
      w: cellSize,
      h: cellSize,
      fill: { color: c.accent ? o.accentHex : o.mutedHex, transparency: c.accent ? 0 : 60 },
      line: { type: 'none' },
    });
  }
}

function drawCursorGlyph(slide: Slide, o: GlyphOpts): void {
  // Right-pointing arrow head — a chevron-y feel. Uses the chevron primitive.
  const size = Math.min(o.w, o.h);
  slide.addShape('chevron', {
    x: o.x + (o.w - size) / 2,
    y: o.y + (o.h - size * 0.7) / 2,
    w: size,
    h: size * 0.7,
    fill: { color: o.accentHex },
    line: { type: 'none' },
  });
}
