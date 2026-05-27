import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { type DeckBrief, DeckBriefSchema } from '../src/deck/brief.js';
import { renderDeck } from '../src/render/renderer.js';

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FIXTURE_BRIEF: DeckBrief = DeckBriefSchema.parse({
  meta: {
    title: 'Knowledge Graphs',
    subtitle: 'A pragmatic guide',
    author: 'DeckPilot',
  },
  theme: {
    accent: '1A2B5E',
    accentAlt: 'C8202E',
    tone: 'editorial',
    aspect: '16:9',
  },
  slides: [
    { id: 'cover', title: 'Knowledge Graphs', purpose: 'Cover slide.', notes: 'Open warm.' },
    {
      id: 'frame',
      title: 'A progression',
      purpose: 'Show four stages.',
      notes: 'Walk the stages.',
    },
    { id: 'missing', title: 'No code yet', purpose: 'Demonstrate the placeholder path.' },
  ],
});

const FIXTURE_CODE = new Map<string, string>([
  [
    'cover',
    `function render(slide, theme, helpers) {
      slide.background = { color: theme.accent };
      slide.addText('Knowledge Graphs', {
        x: 0.6, y: 2.0, w: 12.0, h: 2.0,
        fontFace: theme.fontHeading, fontSize: 84, bold: true,
        color: helpers.contrastInk(theme.accent),
      });
    }`,
  ],
  [
    'frame',
    `function render(slide, theme, helpers) {
      slide.background = { color: theme.paper };
      slide.addText('A progression, not a choice', {
        x: 0.6, y: 0.6, w: 12.0, h: 1.0,
        fontFace: theme.fontHeading, fontSize: 44, bold: true,
        color: theme.accent,
      });
      const cardW = (12.0 - 0.45 * 3) / 4;
      ['DATA', 'MEANING', 'KNOWLEDGE', 'INTELLIGENCE'].forEach((label, i) => {
        const x = 0.6 + i * (cardW + 0.45);
        slide.addShape('roundRect', {
          x, y: 2.4, w: cardW, h: 3.6,
          fill: { color: helpers.lighten(theme.accent, 0.9) },
          line: { color: theme.accent, width: 0 },
          rectRadius: 0.06,
        });
        slide.addText(label, {
          x, y: 3.8, w: cardW, h: 0.8,
          fontFace: theme.fontHeading, fontSize: 22, bold: true,
          color: theme.accent, align: 'center',
        });
      });
    }`,
  ],
]);

describe('renderDeck (code-gen)', () => {
  it('writes a non-empty .pptx with one slide part per brief slide', async () => {
    const out = join(dir, 'kg.pptx');
    const abs = await renderDeck(FIXTURE_BRIEF, FIXTURE_CODE, out);
    expect(abs).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(15_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slidePaths.length).toBe(FIXTURE_BRIEF.slides.length);
  });

  it('emits speaker notes for slides with notes populated in the brief', async () => {
    const out = join(dir, 'notes.pptx');
    await renderDeck(FIXTURE_BRIEF, FIXTURE_CODE, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const notesSlides = Object.keys(zip.files).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    expect(notesSlides.length).toBeGreaterThan(0);
  });

  it('embeds the title text from a slide whose code calls addText', async () => {
    const out = join(dir, 'titles.pptx');
    await renderDeck(FIXTURE_BRIEF, FIXTURE_CODE, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toMatch(/progression, not a choice/);
  });

  it('renders a placeholder slide when no code is supplied for an id', async () => {
    const out = join(dir, 'placeholder.pptx');
    await renderDeck(FIXTURE_BRIEF, FIXTURE_CODE, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
    expect(slide3).toMatch(/slide code not yet written/);
  });

  it('renders rounded-rect shapes when code calls addShape("roundRect", ...)', async () => {
    const out = join(dir, 'cards.pptx');
    await renderDeck(FIXTURE_BRIEF, FIXTURE_CODE, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toMatch(/roundRect/);
  });
});
