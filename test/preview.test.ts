import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderSlideToPng, isPreviewAvailable, _resetSofficeProbe } from '../src/render/preview.js';
import { SlidePlanSchema, type SlidePlan } from '../src/deck/schema.js';

const exec = promisify(execFile);

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-preview-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const plan: SlidePlan = SlidePlanSchema.parse({
  meta: { title: 'Preview Smoke', aspect: '16:9' },
  design: { accent: '1A2B5E', accentAlt: 'C8202E' },
  slides: [
    { id: 'cover', title: 'Preview smoke test', notes: 'Sanity-check the preview pipeline.' },
    {
      id: 'cards',
      kicker: 'Two cards',
      title: 'Side by side',
      body: {
        kind: 'grid',
        columns: 2,
        items: [
          { title: 'Left', body: 'Card body left' },
          { title: 'Right', body: 'Card body right' },
        ],
      },
      notes: 'Cards.',
    },
  ],
});

let haveSoffice = false;
let havePdftoppm = false;

beforeAll(async () => {
  _resetSofficeProbe();
  for (const bin of ['soffice', 'libreoffice']) {
    try {
      await exec('which', [bin]);
      haveSoffice = true;
      break;
    } catch {
      // continue
    }
  }
  try {
    await exec('which', ['pdftoppm']);
    havePdftoppm = true;
  } catch {
    // ignore
  }
});

describe('isPreviewAvailable', () => {
  it('reflects what the host has installed', async () => {
    const v = await isPreviewAvailable();
    expect(v).toBe(haveSoffice);
  });
});

describe('renderSlideToPng', () => {
  it.runIf(haveSoffice && havePdftoppm)(
    'writes a PNG larger than zero bytes for a known slide id',
    async () => {
      const png = await renderSlideToPng(plan, 'cards', { cacheDir: dir });
      expect(png).toMatch(/slide-\d+\.png$/);
      expect(statSync(png).size).toBeGreaterThan(0);
    },
    120_000,
  );

  it.runIf(!haveSoffice)('throws PreviewUnavailableError when soffice is missing', async () => {
    await expect(renderSlideToPng(plan, 'cards', { cacheDir: dir })).rejects.toThrow(/LibreOffice/);
  });
});
