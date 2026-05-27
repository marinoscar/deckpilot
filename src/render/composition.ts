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
  drawCalloutBar,
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
    drawGridItem(slide, item, x, frame.y, cardW, cardH, design, cols);
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
  columns: 2 | 3 | 4,
): void {
  const accentHex = item.accent === 'alt' ? design.accentAlt : design.accent;
  const tintHex = item.accent === 'alt' ? design.cardTintAlt : design.cardTint;

  // Cards are flat against the tinted background — no shadow by default
  // (matches the editorial reference look).
  drawCard(slide, {
    x,
    y,
    w,
    h,
    accentHex,
    tintHex,
    style: design.cardStyle,
    shadow: 'none',
  });

  // Inner padding region. We split it into THREE vertical regions:
  //   topRegion    — kicker + (number badge OR glyph, decoration only)
  //   middleRegion — title + body
  //   bottomRegion — CTA pill (or empty)
  const innerX = x + CARD_PADDING;
  const innerW = w - CARD_PADDING * 2;
  const topY = y + CARD_PADDING;
  const bottomY = y + h - CARD_PADDING;
  const ctaH = item.cta ? 0.5 : 0;

  // ---- top region: kicker (left) + decoration (right or centered top) ----

  let topUsedH = 0;
  if (item.kicker && design.useKickers !== false) {
    drawKicker(slide, {
      x: innerX,
      y: topY,
      w: innerW * 0.7, // leave room on the right for badge/glyph
      text: item.kicker,
      accentHex,
      fontFace: design.fontHeading,
    });
    topUsedH = 0.4;
  }

  // Number badge — placement depends on cardStyle.
  // - top-bar: centered horizontally at the top (image-2 progression look)
  // - side-bar / plain: top-right (image-1 style hint card)
  if (item.number) {
    const size = columns >= 4 ? 0.6 : columns === 3 ? 0.66 : 0.74;
    if (design.cardStyle === 'top-bar') {
      const badgeX = x + (w - size) / 2;
      drawNumberedBadge(slide, {
        x: badgeX,
        y: topY + 0.15, // a touch below the top accent strip
        size,
        label: item.number,
        accentHex,
        fillHex: 'FFFFFF',
        style: design.numberStyle,
        fontFace: design.fontHeading,
      });
      topUsedH = Math.max(topUsedH, size + 0.25);
    } else {
      drawNumberedBadge(slide, {
        x: x + w - CARD_PADDING - size,
        y: topY - 0.05,
        size,
        label: item.number,
        accentHex,
        fillHex: 'FFFFFF',
        style: design.numberStyle,
        fontFace: design.fontHeading,
      });
      topUsedH = Math.max(topUsedH, size + 0.15);
    }
  }

  // Glyph — top-right, only when no number is present.
  if (item.glyph && !item.number) {
    const glyphSize = columns >= 4 ? 0.7 : columns === 3 ? 0.85 : 1.0;
    drawGlyph(slide, item.glyph, {
      x: x + w - CARD_PADDING - glyphSize,
      y: topY + (topUsedH > 0 ? 0 : 0),
      w: glyphSize,
      h: glyphSize,
      accentHex,
      mutedHex: design.muted,
    });
    topUsedH = Math.max(topUsedH, glyphSize + 0.15);
  }

  // ---- middle region: title + body ----

  const middleY = topY + topUsedH;
  const middleH = bottomY - middleY - ctaH - (item.cta ? 0.15 : 0);

  // For top-bar grids with a centered number badge, the title should be
  // centered too — matches the image-2 progression look.
  const centerEverything = design.cardStyle === 'top-bar' && !!item.number;
  const titleSize = pickTitleSize(item.title, columns);
  const titleH = Math.min(middleH * 0.55, titleSize * 0.04 + 0.4);
  slide.addText(item.title, {
    x: innerX,
    y: middleY,
    w: innerW,
    h: titleH,
    fontFace: design.fontHeading,
    fontSize: titleSize,
    bold: true,
    color: accentHex,
    align: centerEverything ? 'center' : 'left',
    valign: 'top',
  });

  // Body fills the gap between title and CTA/bottom.
  if (item.body) {
    const bodyY = middleY + titleH + 0.1;
    const bodyH = bottomY - bodyY - ctaH - (item.cta ? 0.15 : 0);
    const bodyFontSize = columns >= 4 ? 12 : columns === 3 ? 13 : 15;
    if (Array.isArray(item.body)) {
      slide.addText(bulletsToTextProps(item.body, design), {
        x: innerX,
        y: bodyY,
        w: innerW,
        h: bodyH,
        fontFace: design.fontBody,
        fontSize: bodyFontSize,
        color: design.ink,
        valign: 'top',
        paraSpaceAfter: 4,
        align: centerEverything ? 'center' : 'left',
      });
    } else {
      slide.addText(item.body, {
        x: innerX,
        y: bodyY,
        w: innerW,
        h: bodyH,
        fontFace: design.fontBody,
        fontSize: bodyFontSize,
        color: design.ink,
        valign: 'top',
        align: centerEverything ? 'center' : 'left',
      });
    }
  }

  // ---- bottom region: CTA pill ----

  if (item.cta) {
    drawCtaPill(slide, {
      x: innerX,
      y: bottomY - 0.5,
      w: innerW,
      text: item.cta,
      accentHex,
      fontFace: design.fontHeading,
    });
  }
}

/**
 * Roughly-fit title size based on the card's column count.
 *
 * Sizes tuned against reference image 1 (2-col cards with ~56pt titles like
 * "A shared dictionary.") and image 2 (4-col cards with ~28pt centered
 * titles like "DATA" / "INTELLIGENCE"). Short titles get a bigger size; long
 * titles step down so they don't overflow the card.
 *
 *   columns = 2 → 48pt (short) / 36pt (long)
 *   columns = 3 → 32pt (short) / 26pt (long)
 *   columns = 4 → 26pt (short) / 20pt (long)
 *
 * "Short" = ≤ 22 characters.
 */
function pickTitleSize(text: string, columns: 2 | 3 | 4): number {
  const short = text.length <= 22;
  if (columns === 2) return short ? 48 : 36;
  if (columns === 3) return short ? 32 : 26;
  return short ? 26 : 20;
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
  // Image-2's "Bottom line:" bar is the canonical callout look — full-width
  // dark navy band with an accentAlt left edge, bold lead in accentAlt,
  // white body text. drawCalloutBar handles the whole composition; we just
  // need to anchor it within the available frame.
  //
  // We pin the bar to the bottom of the frame and reserve a comfortable
  // height so longer statements have room to breathe. The frame's `x`/`w`
  // are mostly ignored — drawCalloutBar manages its own horizontal margin
  // against the slide width so it always looks full-bleed against the
  // editorial design.
  const barH = body.statement.length > 120 ? 1.1 : 0.85;
  // Slide width is the canonical 13.333 from theme.ts; the drawCalloutBar
  // primitive uses its own SIDE_MARGIN.
  const slideW = 13.333;
  const y = frame.y + frame.h - barH;
  drawCalloutBar(slide, {
    slideW,
    y,
    h: barH,
    statement: body.statement,
    lead: body.lead,
    theme: design,
    edgeAccent: 'alt',
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
