import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { type DeckBrief, DeckBriefSchema } from '../src/deck/brief.js';
import { renderDeck } from '../src/render/renderer.js';
import type { TemplateProfile } from '../src/template/profile.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-renderer-assets-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

const BRIEF: DeckBrief = DeckBriefSchema.parse({
  meta: { title: 'assets test', author: 'DeckPilot' },
  theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
  slides: [{ id: 'cover', title: 'Cover', purpose: 'title slide.' }],
});

// The slide code asserts theme.assets.background is actually wired through, then
// paints it. If Part B regresses (assets dropped), renderDeck throws here.
const CODE = new Map<string, string>([
  [
    'cover',
    `function render(slide, theme) {
       if (!theme.assets || !theme.assets.background) {
         throw new Error('theme.assets.background was not surfaced to slide code');
       }
       slide.background = { path: theme.assets.background };
       slide.addText('Hero', { x: 1, y: 3, w: 11, h: 1, fontSize: 40, color: 'FFFFFF' });
     }`,
  ],
]);

describe('renderDeck — theme.assets wiring', () => {
  it('surfaces an absolute assets.background to slide code and paints it', async () => {
    const bgPath = join(root, 'cover-bg.png');
    writeFileSync(bgPath, PNG_BYTES);

    const template: TemplateProfile = {
      sourcePath: bgPath,
      aspect: '16:9',
      slideSize: { width: 13.33, height: 7.5 },
      colors: { accent: '1A2B5E', accentDark: 'C8202E', paper: 'FFFFFF' },
      fonts: { heading: 'Inter Tight', body: 'Inter' },
      layoutNames: [],
      assets: { background: bgPath },
      rootDir: root,
    };

    const out = join(root, 'with-bg.pptx');
    await renderDeck(BRIEF, CODE, out, { template });

    // The painted background image must land in the output's media.
    const zip = await JSZip.loadAsync(readFileSync(out));
    const media = Object.keys(zip.files).filter((p) => /^ppt\/media\//.test(p));
    expect(media.length).toBeGreaterThan(0);
  });

  it('resolves a relative assets.background against rootDir', async () => {
    writeFileSync(join(root, 'rel-bg.png'), PNG_BYTES);

    const template: TemplateProfile = {
      sourcePath: root,
      aspect: '16:9',
      slideSize: { width: 13.33, height: 7.5 },
      colors: { accent: '1A2B5E', paper: 'FFFFFF' },
      fonts: { heading: 'Inter Tight', body: 'Inter' },
      layoutNames: [],
      assets: { background: 'rel-bg.png' },
      rootDir: root,
    };

    const out = join(root, 'with-rel-bg.pptx');
    // Should not throw — the relative path resolves to root/rel-bg.png.
    await expect(renderDeck(BRIEF, CODE, out, { template })).resolves.toBeDefined();
  });
});
