import { resolve } from 'node:path';
// pptxgenjs has an awkward type shape — its runtime export is a class but
// tsc reads the `export as namespace` + `export default` combo as a namespace.
import pptxgenjsImport from 'pptxgenjs';
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported constructor type
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

import type { DeckBrief } from '../deck/brief.js';
import type { Theme } from '../deck/theme.js';
import type { TemplateProfile } from '../template/profile.js';
import { SlideCodeError, runSlideCode } from './sandbox.js';

export type RenderOptions = {
  /** Optional template profile — its accent/font are folded into the deck theme. */
  template?: TemplateProfile;
  /** Per-slide vm execution timeout, in ms. Defaults to 5000. */
  slideTimeoutMs?: number;
};

/** Map of slide id → LLM-generated render code. */
export type SlideCodeMap = ReadonlyMap<string, string>;

/**
 * Render a DeckBrief plus per-slide code to a `.pptx` on disk.
 *
 * Every slide is rendered by executing its associated TypeScript code inside
 * a vm sandbox — the renderer itself owns no layout decisions. If a slide
 * has no code in `slideCode`, a placeholder slide is emitted instead so the
 * deck stays index-aligned.
 */
export async function renderDeck(
  brief: DeckBrief,
  slideCode: SlideCodeMap,
  outPath: string,
  opts: RenderOptions = {},
): Promise<string> {
  const pres = new PptxGenJS();
  pres.layout = brief.theme.aspect === '4:3' ? 'LAYOUT_STANDARD' : 'LAYOUT_WIDE';
  pres.title = brief.meta.title;
  if (brief.meta.author) pres.author = brief.meta.author;

  const theme = mergeTemplateIntoTheme(brief.theme, opts.template);

  for (const slideBrief of brief.slides) {
    const s = pres.addSlide();
    // Sensible default: paint the paper background even before LLM code runs,
    // so a slide without code still looks intentional.
    s.background = { color: theme.paper };

    const code = slideCode.get(slideBrief.id);
    if (code) {
      runSlideCode(code, s, theme, slideBrief.id, { timeoutMs: opts.slideTimeoutMs });
    } else {
      // Placeholder: title + "no slide code yet" hint.
      s.addText(slideBrief.title, {
        x: 0.6,
        y: 3.0,
        w: 12.0,
        h: 1.4,
        fontFace: theme.fontHeading,
        fontSize: 44,
        bold: true,
        color: theme.accent,
        align: 'center',
        valign: 'middle',
      });
      s.addText('(slide code not yet written)', {
        x: 0.6,
        y: 4.6,
        w: 12.0,
        h: 0.5,
        fontFace: theme.fontBody,
        fontSize: 14,
        italic: true,
        color: theme.muted,
        align: 'center',
      });
    }

    if (slideBrief.notes) s.addNotes(slideBrief.notes);
  }

  const abs = resolve(process.cwd(), outPath);
  await pres.writeFile({ fileName: abs });
  return abs;
}

/** Template overrides theme colours/fonts where present. */
function mergeTemplateIntoTheme(theme: Theme, template: TemplateProfile | undefined): Theme {
  if (!template) return theme;
  return {
    ...theme,
    accent: template.colors.accent ?? theme.accent,
    ...(template.colors.accentDark ? { accentAlt: template.colors.accentDark } : {}),
    ...(template.colors.ink ? { ink: template.colors.ink } : {}),
    ...(template.colors.muted ? { muted: template.colors.muted } : {}),
    ...(template.colors.paper ? { paper: template.colors.paper } : {}),
    fontHeading: template.fonts.heading ?? theme.fontHeading,
    fontBody: template.fonts.body ?? theme.fontBody,
  };
}

export { SlideCodeError };
