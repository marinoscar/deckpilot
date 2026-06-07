/**
 * Slide preview pipeline for the visual critique loop. Renders a DeckBrief
 * + per-slide code to a temp .pptx, then delegates to `pptxToPngs` to
 * rasterise. Caches by content-hash of the brief + code map so a critique
 * pass over N slides only renders the deck once per state.
 *
 * This is the eyes the LLM uses to see its own work — feed the PNG back via
 * the SDK's `binaryResultsForLlm` mechanism.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DeckBrief } from '../deck/brief.js';
import type { TemplateProfile } from '../template/profile.js';
import { log } from '../util/logger.js';
import {
  PreviewUnavailableError,
  _resetSofficeProbe,
  isPreviewAvailable,
  pptxToPngs,
} from './pptx-to-pngs.js';
import { type SlideCodeMap, renderDeck } from './renderer.js';

export { PreviewUnavailableError, _resetSofficeProbe, isPreviewAvailable };

export type PreviewOptions = {
  cacheDir?: string;
  template?: TemplateProfile;
};

/**
 * Render the given slide to a PNG and return the absolute path. Renders the
 * whole deck once into the cache, keyed by a hash of the brief + code map;
 * subsequent calls within the same cache version return the cached PNG.
 */
export async function renderSlideToPng(
  brief: DeckBrief,
  slideCode: SlideCodeMap,
  slideId: string,
  opts: PreviewOptions = {},
): Promise<string> {
  const slideIdx = brief.slides.findIndex((s) => s.id === slideId);
  if (slideIdx < 0) {
    throw new Error(`No slide with id "${slideId}".`);
  }

  const cacheRoot = opts.cacheDir ?? join(tmpdir(), 'deckpilot-previews');
  const stateHash = hashState(brief, slideCode);
  const versionDir = join(cacheRoot, stateHash);
  const pngName = `slide-${String(slideIdx + 1).padStart(3, '0')}.png`;
  const expectedPng = join(versionDir, pngName);

  if (existsSync(expectedPng)) {
    return expectedPng;
  }

  await mkdir(versionDir, { recursive: true });

  const tmpPptx = join(versionDir, 'deck.pptx');
  await renderDeck(brief, slideCode, tmpPptx, opts.template ? { template: opts.template } : {});

  await pptxToPngs(tmpPptx, versionDir);

  if (!existsSync(expectedPng)) {
    throw new Error(
      `Preview rendered but the expected file is missing: ${expectedPng}. The pptx-glimpse renderer may have produced fewer slides than expected.`,
    );
  }
  return expectedPng;
}

/** Stable content hash of (brief + slide-code map). */
function hashState(brief: DeckBrief, slideCode: SlideCodeMap): string {
  const h = createHash('sha1');
  h.update(JSON.stringify(brief));
  // Stable iteration: sort by slide id.
  const entries = [...slideCode.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [id, code] of entries) {
    h.update('');
    h.update(id);
    h.update('');
    h.update(code);
  }
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

export async function readPng(path: string): Promise<Buffer> {
  return readFile(resolve(path));
}
