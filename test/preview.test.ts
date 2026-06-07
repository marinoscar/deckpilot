import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { type DeckBrief, DeckBriefSchema } from '../src/deck/brief.js';
import { isPreviewAvailable, renderSlideToPng } from '../src/render/preview.js';

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-preview-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const brief: DeckBrief = DeckBriefSchema.parse({
  meta: { title: 'Preview Smoke' },
  theme: { accent: '1A2B5E', accentAlt: 'C8202E', aspect: '16:9' },
  slides: [
    { id: 'cover', title: 'Preview smoke test', purpose: 'Sanity-check the preview pipeline.' },
    { id: 'cards', title: 'Side by side', purpose: 'Cards demo.' },
  ],
});

const slideCode = new Map<string, string>([
  [
    'cover',
    `function render(slide, theme, helpers) {
      slide.background = { color: theme.paper };
      slide.addText('Preview smoke test', {
        x: 0.6, y: 3.0, w: 12.0, h: 1.4,
        fontFace: theme.fontHeading, fontSize: 56, bold: true,
        color: theme.accent, align: 'center', valign: 'middle',
      });
    }`,
  ],
  [
    'cards',
    `function render(slide, theme, helpers) {
      slide.background = { color: theme.paper };
      slide.addShape('roundRect', {
        x: 0.6, y: 1.0, w: 5.8, h: 5.5,
        fill: { color: helpers.lighten(theme.accent, 0.9) },
        line: { color: theme.accent, width: 0 },
        rectRadius: 0.06,
      });
      slide.addShape('roundRect', {
        x: 6.9, y: 1.0, w: 5.8, h: 5.5,
        fill: { color: helpers.lighten(theme.accentAlt, 0.9) },
        line: { color: theme.accentAlt, width: 0 },
        rectRadius: 0.06,
      });
      slide.addText('Left', { x: 0.9, y: 1.4, w: 5.2, h: 0.8, fontFace: theme.fontHeading, fontSize: 32, bold: true, color: theme.accent });
      slide.addText('Right', { x: 7.2, y: 1.4, w: 5.2, h: 0.8, fontFace: theme.fontHeading, fontSize: 32, bold: true, color: theme.accentAlt });
    }`,
  ],
]);

describe('isPreviewAvailable', () => {
  it('is always true — the renderer is a bundled pure-JS dependency', async () => {
    const v = await isPreviewAvailable();
    expect(v).toBe(true);
  });
});

describe('renderSlideToPng', () => {
  it('writes a PNG larger than zero bytes for a known slide id', async () => {
    const png = await renderSlideToPng(brief, slideCode, 'cards', { cacheDir: dir });
    expect(png).toMatch(/slide-\d+\.png$/);
    expect(statSync(png).size).toBeGreaterThan(0);
  }, 120_000);
});
