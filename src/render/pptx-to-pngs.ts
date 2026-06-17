/**
 * Standalone .pptx → PNGs pipeline. Used by:
 *   - The visual critique loop (renderSlideToPng builds a deck first, then
 *     calls into this to rasterise).
 *   - Vision-driven template extraction (renders a user-supplied .pptx
 *     directly, no deck construction).
 *
 * Pipeline: pure-JS via `pptx-glimpse` (renders text through opentype.js to
 * SVG, then rasterises to PNG). No external binaries — no LibreOffice, no
 * poppler — so previews work out of the box on Windows and Linux.
 *
 * Fonts: opentype.js (pptx-glimpse's shaper) throws on GSUB lookupType 7
 * ("Extension Substitution"), which modern Windows fonts (Calibri, Arial,
 * Cambria, Segoe UI, Carlito) all carry — and stock Windows ships no safe
 * substitute, so the OS font scan alone breaks every preview there. We guard
 * this two ways: (1) bundle opentype.js-safe fonts (Noto Sans / Noto Serif)
 * and route the common brand/system fonts to them via the mapping below, with
 * the bundled dir searched first; (2) if a render still throws, retry once
 * with `skipSystemFonts` so opentype.js only ever sees the bundled fonts. The
 * generated .pptx itself always carries the correct font names — only the
 * preview is approximate.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertPptxToPng } from 'pptx-glimpse';
import { builtinFontsRoot } from '../store/paths.js';

/**
 * Substitutes for the fonts DeckPilot themes commonly request, so previews
 * stay legible — and so opentype.js never trips on a lookupType-7 font (see
 * file header). Merged on top of pptx-glimpse's own DEFAULT_FONT_MAPPING
 * (Calibri→Carlito), which we deliberately override: Carlito is rarely
 * installed and recent builds also carry lookupType 7. Targets resolve to the
 * bundled Noto fonts (searched ahead of OS fonts), which are verified safe.
 */
const FONT_MAPPING: Record<string, string> = {
  Inter: 'Noto Sans',
  'Inter Tight': 'Noto Sans',
  Arial: 'Noto Sans',
  Helvetica: 'Noto Sans',
  Calibri: 'Noto Sans',
  'Calibri Light': 'Noto Sans',
  'Segoe UI': 'Noto Sans',
  Tahoma: 'Noto Sans',
  Verdana: 'Noto Sans',
  Cambria: 'Noto Serif',
  'Times New Roman': 'Noto Serif',
  Georgia: 'Noto Serif',
};

/** Slide width in inches for a 16:9 deck (see slide-api.ts SLIDE dims). */
const SLIDE_WIDTH_IN = 13.333;

export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewUnavailableError';
  }
}

/**
 * The pure-JS renderer is always present (it's a bundled dependency), so
 * previews are always available. Kept async + boolean for API compatibility
 * with the callers that gate the visual loop on it.
 */
export async function isPreviewAvailable(): Promise<boolean> {
  return typeof convertPptxToPng === 'function';
}

/**
 * Test-only escape hatch. The old soffice-probe cache is gone, so this is a
 * no-op kept for callers/tests that still import it.
 */
export function _resetSofficeProbe(): void {
  // no-op — there is no binary probe to reset anymore.
}

export type PptxToPngsOptions = {
  /**
   * Approximate output resolution. Mapped to a pixel width
   * (`round(13.333in * dpi)`); height tracks the deck's real aspect ratio.
   * 150 = preview quality, 100 = lighter for vision-driven extraction.
   */
  dpi?: number;
  /** Retained for API compatibility; rendering is in-process so this is a no-op. */
  timeoutMs?: number;
  /** Extra font directories to scan in addition to the OS font dirs. */
  fontDirs?: string[];
  /** Extra PPTX-font → substitute mappings, merged over the defaults. */
  fontMapping?: Record<string, string>;
};

/**
 * Rasterise an existing .pptx into one PNG per slide.
 *
 * Returns absolute paths to `<outDir>/slide-001.png`, `slide-002.png`, …
 * in slide order. `outDir` is created if it doesn't exist.
 */
export async function pptxToPngs(
  pptxPath: string,
  outDir: string,
  opts: PptxToPngsOptions = {},
): Promise<string[]> {
  if (!existsSync(pptxPath)) {
    throw new Error(`No such file: ${pptxPath}`);
  }

  await mkdir(outDir, { recursive: true });

  const dpi = opts.dpi ?? 150;
  // pptx-glimpse takes pixel width (not dpi); height is derived from the
  // slide's true aspect ratio, so 4:3 and 16:9 decks both render correctly.
  const width = Math.round(SLIDE_WIDTH_IN * dpi);

  const buf = await readFile(pptxPath);
  const bundledFonts = builtinFontsRoot();
  const fontMapping = { ...FONT_MAPPING, ...(opts.fontMapping ?? {}) };
  let results: Awaited<ReturnType<typeof convertPptxToPng>>;
  try {
    // Bundled safe fonts first, then any caller dirs, then the OS scan.
    // logLevel 'off': previews are approximate by design, so pptx-glimpse's
    // per-feature warnings (font.notFound, graphicFrame.unsupported, …) are just
    // noise on the user's console — the saved .pptx is unaffected.
    results = await convertPptxToPng(buf, {
      width,
      logLevel: 'off',
      fontMapping,
      fontDirs: [bundledFonts, ...(opts.fontDirs ?? [])],
    });
  } catch {
    // Most likely an OS font tripped opentype.js (lookupType 7). Retry using
    // only the bundled safe fonts, with the OS scan disabled entirely.
    try {
      results = await convertPptxToPng(buf, {
        width,
        logLevel: 'off',
        fontMapping,
        fontDirs: [bundledFonts],
        skipSystemFonts: true,
      });
    } catch (e) {
      throw new PreviewUnavailableError(`pptx-glimpse render failed: ${(e as Error).message}`);
    }
  }

  if (results.length === 0) {
    throw new Error(`No slides rendered from ${pptxPath}`);
  }

  // Zero-pad so the filenames sort lexically and stably across deck sizes.
  results.sort((a, b) => a.slideNumber - b.slideNumber);
  const pngs: string[] = [];
  for (const r of results) {
    const name = `slide-${String(r.slideNumber).padStart(3, '0')}.png`;
    const outPath = join(outDir, name);
    await writeFile(outPath, r.png);
    pngs.push(outPath);
  }
  return pngs;
}

export async function readPng(path: string): Promise<Buffer> {
  return readFile(path);
}

/** Wipe a cache directory entirely. */
export async function clearDir(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}
