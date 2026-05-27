/**
 * Composition interpreters. Each function takes one slide's `body` (a
 * `Composition`) and lays it out within a given content rectangle using
 * primitives. The renderer orchestrator owns kicker/title/subtitle/footer;
 * these functions own everything from the area below the subtitle to the
 * area above the footer.
 */

import type {
  Bullet,
  Composition,
  DesignSystem,
  GridItem,
  StepItem,
} from '../deck/schema.js';
import {
  drawCard,
  drawCtaPill,
  drawGlyph,
  drawKicker,
  drawNumberedBadge,
  type Slide,
} from './primitives.js';

const COL_GAP = 0.35;
const CARD_PADDING = 0.35;

export type CompositionFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function renderComposition(
  slide: Slide,
  body: Composition,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  switch (body.kind) {
    case 'prose':
      return renderProse(slide, body, frame, design);
    case 'grid':
      return renderGrid(slide, body, frame, design);
    case 'steps':
      return renderSteps(slide, body, frame, design);
    case 'callout':
      return renderCallout(slide, body, frame, design);
    case 'quote':
      return renderQuote(slide, body, frame, design);
  }
}

// ---------- prose ----------

function renderProse(
  slide: Slide,
  body: Extract<Composition, { kind: 'prose' }>,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  let cursorY = frame.y;
  if (body.lead) {
    slide.addText(body.lead, {
      x: frame.x,
      y: cursorY,
      w: frame.w,
      h: 0.8,
      fontFace: design.fontBody,
      fontSize: 18,
      color: design.ink,
      valign: 'top',
      paraSpaceAfter: 4,
    });
    cursorY += 0.85;
  }
  if (body.bullets?.length) {
    slide.addText(bulletsToTextProps(body.bullets, design), {
      x: frame.x,
      y: cursorY,
      w: frame.w,
      h: frame.h - (cursorY - frame.y),
      fontFace: design.fontBody,
      fontSize: 20,
      color: design.ink,
      valign: 'top',
      paraSpaceAfter: 8,
    });
  }
}

// ---------- grid ----------

function renderGrid(
  slide: Slide,
  body: Extract<Composition, { kind: 'grid' }>,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  const cols = body.columns;
  const items = body.items;
  // Width math: total - (cols-1)*gap, divided across cols.
  const gridW = frame.w;
  const cardW = (gridW - COL_GAP * (cols - 1)) / cols;
  // Card height fills the frame.
  const cardH = frame.h;

  for (let i = 0; i < items.length && i < cols; i++) {
    const item = items[i]!;
    const x = frame.x + i * (cardW + COL_GAP);
    drawGridItem(slide, item, x, frame.y, cardW, cardH, design);
  }
}

function drawGridItem(
  slide: Slide,
  item: GridItem,
  x: number,
  y: number,
  w: number,
  h: number,
  design: DesignSystem,
): void {
  const accentHex = item.accent === 'alt' ? design.accentAlt : design.accent;
  const tintHex = item.accent === 'alt' ? design.cardTintAlt : design.cardTint;

  drawCard(slide, {
    x,
    y,
    w,
    h,
    accentHex,
    tintHex,
    style: design.cardStyle,
    shadow: 'soft',
  });

  // Inner padding cursor
  const innerX = x + CARD_PADDING;
  const innerW = w - CARD_PADDING * 2;
  let cursorY = y + CARD_PADDING;

  // Optional kicker
  if (item.kicker && design.useKickers !== false) {
    drawKicker(slide, {
      x: innerX,
      y: cursorY,
      w: innerW,
      text: item.kicker,
      accentHex,
      fontFace: design.fontHeading,
    });
    cursorY += 0.4;
  }

  // Optional number badge (rendered top-right of card, doesn't push cursor)
  if (item.number) {
    const size = 0.6;
    drawNumberedBadge(slide, {
      x: x + w - CARD_PADDING - size,
      y: y + CARD_PADDING - 0.05,
      size,
      label: item.number,
      accentHex,
      fillHex: 'FFFFFF',
      style: design.numberStyle,
      fontFace: design.fontHeading,
    });
  }

  // Optional glyph (rendered top-right of card if no number)
  if (item.glyph && !item.number) {
    const glyphSize = 0.9;
    drawGlyph(slide, item.glyph, {
      x: x + w - CARD_PADDING - glyphSize,
      y: y + CARD_PADDING,
      w: glyphSize,
      h: glyphSize,
      accentHex,
      mutedHex: design.muted,
    });
  }

  // Title — big bold statement, dominant element.
  const titleY = cursorY + (item.number || item.glyph ? 0.5 : 0);
  const titleSize = pickTitleSize(item.title, w);
  slide.addText(item.title, {
    x: innerX,
    y: titleY,
    w: innerW,
    h: 1.4,
    fontFace: design.fontHeading,
    fontSize: titleSize,
    bold: true,
    color: accentHex,
    align: 'left',
    valign: 'top',
  });
  cursorY = titleY + Math.max(1.0, titleSize * 0.045);

  // Body — paragraph or bullets
  if (item.body) {
    const bodyH = h - (cursorY - y) - CARD_PADDING - (item.cta ? 0.65 : 0);
    if (Array.isArray(item.body)) {
      slide.addText(bulletsToTextProps(item.body, design), {
        x: innerX,
        y: cursorY,
        w: innerW,
        h: bodyH,
        fontFace: design.fontBody,
        fontSize: 14,
        color: design.ink,
        valign: 'top',
        paraSpaceAfter: 4,
      });
    } else {
      slide.addText(item.body, {
        x: innerX,
        y: cursorY,
        w: innerW,
        h: bodyH,
        fontFace: design.fontBody,
        fontSize: 14,
        color: design.ink,
        valign: 'top',
      });
    }
  }

  // CTA pill at the bottom of the card
  if (item.cta) {
    drawCtaPill(slide, {
      x: innerX,
      y: y + h - CARD_PADDING - 0.45,
      w: innerW,
      text: item.cta,
      accentHex,
      fontFace: design.fontHeading,
    });
  }
}

/** Roughly-fit title size so longer titles don't overflow a card. */
function pickTitleSize(text: string, cardW: number): number {
  const len = text.length;
  // Wider cards can afford bigger titles.
  if (cardW > 5) return len > 30 ? 26 : 32;
  if (cardW > 3.5) return len > 24 ? 20 : 26;
  return len > 18 ? 16 : 20;
}

// ---------- steps ----------

function renderSteps(
  slide: Slide,
  body: Extract<Composition, { kind: 'steps' }>,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  const items = body.items;
  const n = items.length;
  const colW = frame.w / n;
  const badgeSize = 0.85;
  const badgeY = frame.y + 0.4;

  // Connector line behind the badges
  slide.addShape('line', {
    x: frame.x + colW / 2,
    y: badgeY + badgeSize / 2,
    w: frame.w - colW,
    h: 0,
    line: { color: design.muted, width: 1, dashType: 'dash' },
  });

  for (let i = 0; i < n; i++) {
    const item = items[i]!;
    const cx = frame.x + colW * (i + 0.5);
    const accentHex = item.accent === 'alt' ? design.accentAlt : design.accent;
    drawNumberedBadge(slide, {
      x: cx - badgeSize / 2,
      y: badgeY,
      size: badgeSize,
      label: item.number,
      accentHex,
      style: design.numberStyle,
      fontFace: design.fontHeading,
    });
    // Title
    slide.addText(item.title, {
      x: frame.x + colW * i + 0.1,
      y: badgeY + badgeSize + 0.2,
      w: colW - 0.2,
      h: 0.5,
      fontFace: design.fontHeading,
      fontSize: 16,
      bold: true,
      color: accentHex,
      align: 'center',
      valign: 'top',
    });
    if (item.description) {
      slide.addText(item.description, {
        x: frame.x + colW * i + 0.15,
        y: badgeY + badgeSize + 0.75,
        w: colW - 0.3,
        h: 1.2,
        fontFace: design.fontBody,
        fontSize: 12,
        color: design.muted,
        align: 'center',
        valign: 'top',
      });
    }
  }
}

// ---------- callout ----------

function renderCallout(
  slide: Slide,
  body: Extract<Composition, { kind: 'callout' }>,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  let cursorY = frame.y + frame.h * 0.2;
  if (body.lead) {
    slide.addText(body.lead, {
      x: frame.x,
      y: cursorY,
      w: frame.w,
      h: 0.6,
      fontFace: design.fontBody,
      fontSize: 16,
      color: design.muted,
      italic: true,
      align: 'left',
    });
    cursorY += 0.6;
  }
  slide.addText(body.statement, {
    x: frame.x,
    y: cursorY,
    w: frame.w,
    h: frame.h - (cursorY - frame.y),
    fontFace: design.fontHeading,
    fontSize: body.statement.length > 120 ? 28 : body.statement.length > 80 ? 36 : 44,
    bold: true,
    color: design.accent,
    align: 'left',
    valign: 'top',
  });
}

// ---------- quote ----------

function renderQuote(
  slide: Slide,
  body: Extract<Composition, { kind: 'quote' }>,
  frame: CompositionFrame,
  design: DesignSystem,
): void {
  // Oversized accent quote glyph
  slide.addText('“', {
    x: frame.x,
    y: frame.y,
    w: 2,
    h: 2,
    fontFace: design.fontHeading,
    fontSize: 180,
    bold: true,
    color: design.accent,
    align: 'left',
    valign: 'top',
  });
  slide.addText(body.text, {
    x: frame.x + 0.3,
    y: frame.y + 1.4,
    w: frame.w - 0.3,
    h: frame.h - 2,
    fontFace: design.fontHeading,
    fontSize: 32,
    italic: true,
    color: design.ink,
    valign: 'top',
  });
  if (body.attribution) {
    slide.addText(`— ${body.attribution}`, {
      x: frame.x + 0.3,
      y: frame.y + frame.h - 0.6,
      w: frame.w - 0.3,
      h: 0.5,
      fontFace: design.fontBody,
      fontSize: 16,
      color: design.muted,
      align: 'left',
    });
  }
}

// ---------- shared ----------

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs TextProps[] shape
function bulletsToTextProps(bullets: Bullet[], design: DesignSystem): any[] {
  return bullets.map((b) => ({
    text: b.text,
    options: {
      bullet: { indent: b.level === 1 ? 28 : 18 },
      indentLevel: b.level,
      color: b.level === 1 ? design.muted : design.ink,
    },
  }));
}
