/**
 * Slide preview pipeline. Renders a SlidePlan to a temp .pptx, then shells
 * out to LibreOffice headless (`soffice --headless --convert-to png`) to
 * rasterise each slide to a PNG. Returns the path to the requested slide's
 * PNG; the result is cached by a content-hash of the plan so a critique pass
 * over N slides only renders the deck once.
 *
 * This is the eyes the LLM uses to see its own work — feed the PNG back via
 * the SDK's `binaryResultsForLlm` mechanism.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { renderPlan } from './renderer.js';
import type { SlidePlan } from '../deck/schema.js';
import type { TemplateProfile } from '../template/profile.js';
import { log } from '../util/logger.js';

const exec = promisify(execFile);

export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewUnavailableError';
  }
}

/** Resolve which soffice binary to use, if any. */
let cachedBinary: string | null | undefined;
async function findSofficeBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const candidate of ['soffice', 'libreoffice']) {
    try {
      await exec('which', [candidate]);
      cachedBinary = candidate;
      return candidate;
    } catch {
      // continue
    }
  }
  cachedBinary = null;
  return null;
}

/** Reset the cached lookup. Test-only escape hatch. */
export function _resetSofficeProbe(): void {
  cachedBinary = undefined;
}

export async function isPreviewAvailable(): Promise<boolean> {
  return (await findSofficeBinary()) !== null;
}

export type PreviewOptions = {
  /** Working directory for preview cache. Defaults to <os.tmpdir>/deckpilot-previews. */
  cacheDir?: string;
  /** Template to pass through to the renderer (theme inheritance). */
  template?: TemplateProfile;
};

/**
 * Render the given slide to a PNG and return the absolute path. Renders the
 * whole deck once into the cache, keyed by a hash of the plan; subsequent
 * calls within the same cache version return the cached PNG.
 */
export async function renderSlideToPng(
  plan: SlidePlan,
  slideId: string,
  opts: PreviewOptions = {},
): Promise<string> {
  const soffice = await findSofficeBinary();
  if (!soffice) {
    throw new PreviewUnavailableError(
      'LibreOffice is not installed. The visual critique loop needs `soffice` / `libreoffice` on $PATH. On Ubuntu/WSL: sudo apt install libreoffice. Skip this step or set --critique-passes 0 to bypass.',
    );
  }
  const slideIdx = plan.slides.findIndex((s) => s.id === slideId);
  if (slideIdx < 0) {
    throw new Error(`No slide with id "${slideId}".`);
  }

  const cacheRoot = opts.cacheDir ?? join(tmpdir(), 'deckpilot-previews');
  const planHash = hashPlan(plan);
  const versionDir = join(cacheRoot, planHash);
  const pngName = `slide-${String(slideIdx + 1).padStart(3, '0')}.png`;
  const expectedPng = join(versionDir, pngName);

  // Cache hit
  if (existsSync(expectedPng)) {
    return expectedPng;
  }

  await mkdir(versionDir, { recursive: true });

  // 1) Render the deck to a temp .pptx inside the cache dir
  const tmpPptx = join(versionDir, 'deck.pptx');
  await renderPlan(plan, tmpPptx, opts.template ? { template: opts.template } : {});

  // 2) Convert with LibreOffice headless — produces one PNG per slide.
  //    LibreOffice's PNG export is a "first slide only" thing by default, so
  //    we use `--convert-to pdf` first then rasterise. The simplest robust
  //    path: convert to PNG with the `:impress_png_Export:...` filter, which
  //    does emit per-slide images named `<base>-N.png`. Falling back to PDF
  //    is messier; we go directly to PNG.
  try {
    await exec(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nofirststartwizard',
        '--convert-to',
        'png',
        '--outdir',
        versionDir,
        tmpPptx,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 50 },
    );
  } catch (e) {
    throw new Error(`LibreOffice failed to render slides: ${(e as Error).message}`);
  }

  // LibreOffice's PNG export only emits the first slide as `deck.png`. To get
  // per-slide images we go via PDF and rasterise. We use LibreOffice itself
  // to produce a PDF, then `pdftoppm` to slice into PNGs. `pdftoppm` is part
  // of `poppler-utils` which is almost always co-installed with LibreOffice
  // on Linux. If it's missing we surface a clear error.
  const slidesDirEntries = await readdir(versionDir);
  const alreadyHavePerSlide = slidesDirEntries.some((f) => /^slide-\d{3}\.png$/.test(f));
  if (!alreadyHavePerSlide) {
    await rasteriseViaPdf(soffice, tmpPptx, versionDir);
  }

  if (!existsSync(expectedPng)) {
    throw new Error(
      `Preview rendered but the expected file is missing: ${expectedPng}. Check that LibreOffice + pdftoppm are installed.`,
    );
  }
  return expectedPng;
}

async function rasteriseViaPdf(soffice: string, pptxPath: string, outDir: string): Promise<void> {
  // Step A: pptx → pdf
  try {
    await exec(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nofirststartwizard',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        pptxPath,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 50 },
    );
  } catch (e) {
    throw new Error(`LibreOffice PDF export failed: ${(e as Error).message}`);
  }

  const pdfPath = pptxPath.replace(/\.pptx$/i, '.pdf');
  if (!existsSync(pdfPath)) {
    throw new Error(`Expected ${pdfPath} after LibreOffice PDF conversion`);
  }

  // Step B: pdf → png series via pdftoppm (poppler)
  try {
    await exec('which', ['pdftoppm']);
  } catch {
    throw new PreviewUnavailableError(
      '`pdftoppm` (poppler-utils) is required for the preview pipeline. On Ubuntu/WSL: sudo apt install poppler-utils.',
    );
  }

  const slidePrefix = join(outDir, 'slide');
  try {
    await exec(
      'pdftoppm',
      ['-png', '-r', '150', pdfPath, slidePrefix],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 50 },
    );
  } catch (e) {
    throw new Error(`pdftoppm failed: ${(e as Error).message}`);
  }

  // pdftoppm names files slide-1.png, slide-2.png … with no zero-pad. Rename
  // to slide-001.png style so the cache key is stable across deck sizes.
  const entries = await readdir(outDir);
  for (const f of entries) {
    const m = f.match(/^slide-(\d+)\.png$/);
    if (!m) continue;
    const n = Number(m[1]);
    const padded = `slide-${String(n).padStart(3, '0')}.png`;
    if (padded === f) continue;
    const oldPath = join(outDir, f);
    const newPath = join(outDir, padded);
    if (!existsSync(newPath)) {
      const data = await readFile(oldPath);
      await writeFile(newPath, data);
      await rm(oldPath);
    }
  }
}

/** Stable content hash of a plan — used as the preview cache key. */
function hashPlan(plan: SlidePlan): string {
  const h = createHash('sha1');
  h.update(JSON.stringify(plan));
  return h.digest('hex').slice(0, 16);
}

export async function clearPreviewCache(cacheDir?: string): Promise<void> {
  const root = cacheDir ?? join(tmpdir(), 'deckpilot-previews');
  if (!existsSync(root)) return;
  try {
    await rm(root, { recursive: true, force: true });
    log.debug('Cleared preview cache at', root);
  } catch (e) {
    log.warn('clearPreviewCache failed:', (e as Error).message);
  }
}

/** Resolve `path` and read its bytes — small helper used by the SDK tool. */
export async function readPng(path: string): Promise<Buffer> {
  return readFile(resolve(path));
}
