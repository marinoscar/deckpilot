import { resolve } from 'node:path';
// pptxgenjs has an awkward type shape — its runtime export is a class but
// tsc reads the `export as namespace` + `export default` combo as a namespace.
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs constructor typing workaround
import pptxgenjsImport from 'pptxgenjs';
// biome-ignore lint/suspicious/noExplicitAny: see above
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

import type { DesignSystem, Slide, SlidePlan } from '../deck/schema.js';
import type { TemplateProfile } from '../template/profile.js';
import { drawCornerAccent, drawFooterBand, drawKicker, type Slide as PSlide } from './primitives.js';
import { renderComposition, type CompositionFrame } from './composition.js';

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SIDE_MARGIN = 0.6;
const TOP_MARGIN = 0.5;
const FOOTER_RESERVED = 0.7;

export type RenderOptions = {
  /** Template inheritance: theme colours/fonts override the deck's design system. */
  template?: TemplateProfile;
};

/**
 * Render a validated SlidePlan to a `.pptx` file on disk.
 *
 * Design philosophy: the plan carries a `DesignSystem` (palette + tone +
 * decorative habits). The renderer is a thin orchestrator that:
 *   1. Resolves the final design system (template overrides plan-level
 *      colours/fonts where set).
 *   2. For each slide: paints background, draws kicker/title/subtitle,
 *      dispatches body to a composition interpreter (prose/grid/steps/
 *      callout/quote), then draws optional footer band + corner accents.
 *
 * No layout-specific code lives at this layer; that's all in
 * `composition.ts` + `primitives.ts`.
 */
export async function renderPlan(
  plan: SlidePlan,
  outPath: string,
  opts: RenderOptions = {},
): Promise<string> {
  const pres = new PptxGenJS();
  pres.layout = plan.meta.aspect === '4:3' ? 'LAYOUT_STANDARD' : 'LAYOUT_WIDE';
  pres.title = plan.meta.title;
  if (plan.meta.author) pres.author = plan.meta.author;

  const design = mergeTemplateIntoDesign(plan.design, opts.template);
  const total = plan.slides.length;

  plan.slides.forEach((slide, idx) => {
    const s = pres.addSlide();
    paintBackground(s, slide, design);
    if (design.cornerAccents) {
      drawCornerAccent(s, {
        slideW: SLIDE_W,
        slideH: SLIDE_H,
        corner: 'tr',
        color: idx % 2 === 0 ? design.accent : design.accentAlt,
      });
    }
    let cursorY = TOP_MARGIN;
    if (slide.kicker && design.useKickers !== false) {
      drawKicker(s, {
        x: SIDE_MARGIN,
        y: cursorY,
        w: SLIDE_W - SIDE_MARGIN * 2,
        text: slide.kicker,
        accentHex: textColorForBackground(slide.background, design),
        fontFace: design.fontHeading,
      });
      cursorY += 0.45;
    }
    if (slide.title) {
      const titleSize = pickSlideTitleSize(slide.title);
      s.addText(slide.title, {
        x: SIDE_MARGIN,
        y: cursorY,
        w: SLIDE_W - SIDE_MARGIN * 2,
        h: 1.2,
        fontFace: design.fontHeading,
        fontSize: titleSize,
        bold: true,
        color: textColorForBackground(slide.background, design),
        align: 'left',
        valign: 'top',
      });
      cursorY += Math.max(0.9, titleSize * 0.03);
    }
    if (slide.subtitle) {
      s.addText(slide.subtitle, {
        x: SIDE_MARGIN,
        y: cursorY,
        w: SLIDE_W - SIDE_MARGIN * 2,
        h: 0.6,
        fontFace: design.fontBody,
        fontSize: 18,
        italic: true,
        color: subtitleColorForBackground(slide.background, design),
        align: 'left',
        valign: 'top',
      });
      cursorY += 0.55;
    }

    if (slide.body) {
      const frame: CompositionFrame = {
        x: SIDE_MARGIN,
        y: cursorY + 0.2,
        w: SLIDE_W - SIDE_MARGIN * 2,
        h: SLIDE_H - cursorY - FOOTER_RESERVED - 0.2,
      };
      renderComposition(s, slide.body, frame, design);
    }

    // Footer band — only on paper-background slides, never on the first slide
    // (covers) or on slides that opted out via the footer field.
    if (
      design.useFooterBand &&
      slide.background === 'paper' &&
      idx > 0
    ) {
      drawFooterBand(s, {
        slideW: SLIDE_W,
        slideH: SLIDE_H,
        deckTitle: plan.meta.title,
        section: slide.footer?.section,
        page: slide.footer?.page ?? idx + 1,
        total,
        theme: design,
      });
    }

    s.addNotes(slide.notes ?? '');
  });

  const abs = resolve(process.cwd(), outPath);
  await pres.writeFile({ fileName: abs });
  return abs;
}

function pickSlideTitleSize(text: string): number {
  if (text.length > 60) return 32;
  if (text.length > 30) return 42;
  return 50;
}

function paintBackground(s: PSlide, slide: Slide, design: DesignSystem): void {
  switch (slide.background) {
    case 'accent':
      s.background = { color: design.accent };
      return;
    case 'accentAlt':
      s.background = { color: design.accentAlt };
      return;
    case 'paper':
    default:
      s.background = { color: design.paper };
  }
}

function textColorForBackground(bg: Slide['background'], design: DesignSystem): string {
  if (bg === 'accent' || bg === 'accentAlt') return design.paper;
  return design.accent;
}

function subtitleColorForBackground(bg: Slide['background'], design: DesignSystem): string {
  if (bg === 'accent' || bg === 'accentAlt') return design.paper;
  return design.muted;
}

/** Template overrides design colours/fonts where present (theme inheritance from M3). */
function mergeTemplateIntoDesign(
  design: DesignSystem,
  template: TemplateProfile | undefined,
): DesignSystem {
  if (!template) return design;
  return {
    ...design,
    accent: template.colors.accent ?? design.accent,
    ...(template.colors.accentDark ? { accentAlt: template.colors.accentDark } : {}),
    ...(template.colors.ink ? { ink: template.colors.ink } : {}),
    ...(template.colors.muted ? { muted: template.colors.muted } : {}),
    ...(template.colors.paper ? { paper: template.colors.paper } : {}),
    fontHeading: template.fonts.heading ?? design.fontHeading,
    fontBody: template.fonts.body ?? design.fontBody,
  };
}
