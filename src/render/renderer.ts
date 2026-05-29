import { join, resolve } from 'node:path';
// pptxgenjs has an awkward type shape — its runtime export is a class but
// tsc reads the `export as namespace` + `export default` combo as a namespace.
import pptxgenjsImport from 'pptxgenjs';
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported constructor type
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

import type { DeckBrief } from '../deck/brief.js';
import type { Theme } from '../deck/theme.js';
import type { TemplateProfile } from '../template/profile.js';
import type { Master } from '../template/spec.js';
import { SlideCodeError, runSlideCode } from './sandbox.js';

const MASTER_NAME = 'TemplateMaster';

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

  // v0.16: when the template carries a brand master, define it once. Every
  // generated slide then references it via `addSlide({ masterName })`,
  // inheriting the master's background + logo + footer at display time.
  const master = opts.template?.master;
  const masterRootDir = opts.template?.rootDir;
  const masterActive = master !== undefined;
  if (masterActive) {
    applyMaster(pres, master, masterRootDir);
  }

  for (const slideBrief of brief.slides) {
    const s = masterActive ? pres.addSlide({ masterName: MASTER_NAME }) : pres.addSlide();
    // Default paper background — but only when the master isn't already
    // painting its own. When the master sets a background, leaving this in
    // would override the brand chrome.
    if (!master?.background) {
      s.background = { color: theme.paper };
    }

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

/**
 * Translate a Master spec into a pptxgenjs `defineSlideMaster` call.
 *
 * Each `objects[*]` entry maps to one master object pptxgenjs understands:
 *   { kind: 'image' } → { image: { x, y, w, h, path } }
 *   { kind: 'rect'  } → { rect:  { x, y, w, h, fill: { color } } }
 *   { kind: 'text'  } → { text:  { text, options: { x, y, w, h, ... } } }
 *
 * Relative `src` paths are resolved against `rootDir` via `path.join` so the
 * call works identically on Windows + Linux/macOS.
 */
function applyMaster(
  // biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported class type
  pres: any,
  master: Master,
  rootDir: string | undefined,
): void {
  const props: Record<string, unknown> = { title: MASTER_NAME };
  if (master.background) {
    if (master.background.type === 'solid') {
      props.background = { color: master.background.color };
    } else if (master.background.type === 'image') {
      const path = resolveSrc(master.background.src, rootDir);
      if (path) props.background = { path };
    }
  }
  if (master.objects && master.objects.length > 0) {
    const out: Record<string, unknown>[] = [];
    for (const obj of master.objects) {
      if (obj.kind === 'image') {
        const path = resolveSrc(obj.src, rootDir);
        if (!path) continue;
        out.push({
          image: { x: obj.x, y: obj.y, w: obj.w, h: obj.h, path },
        });
      } else if (obj.kind === 'rect') {
        out.push({
          rect: {
            x: obj.x,
            y: obj.y,
            w: obj.w,
            h: obj.h,
            fill: { color: obj.fill },
          },
        });
      } else if (obj.kind === 'text') {
        const textOpts: Record<string, unknown> = {
          x: obj.x,
          y: obj.y,
          w: obj.w,
          h: obj.h,
        };
        if (obj.fontFace) textOpts.fontFace = obj.fontFace;
        if (obj.fontSize) textOpts.fontSize = obj.fontSize;
        if (obj.bold) textOpts.bold = obj.bold;
        if (obj.color) textOpts.color = obj.color;
        if (obj.align) textOpts.align = obj.align;
        out.push({ text: { text: obj.text, options: textOpts } });
      }
    }
    if (out.length > 0) props.objects = out;
  }
  pres.defineSlideMaster(props);
}

/**
 * Resolve a relative master asset src against the template's rootDir.
 * Returns undefined when no rootDir is available — the renderer drops the
 * object rather than emitting a broken pptxgenjs reference.
 */
function resolveSrc(src: string, rootDir: string | undefined): string | undefined {
  if (!rootDir) return undefined;
  // src uses POSIX-style forward slashes inside template.json; split + join
  // so Windows produces the correct \-separated absolute path.
  return join(rootDir, ...src.split('/'));
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
