import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { renderPlan } from '../src/render/renderer.js';
import { SlidePlanSchema, type SlidePlan } from '../src/deck/schema.js';
import { applySlidePatch } from '../src/deck/revise.js';

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A representative v0.5 plan exercising all five composition kinds plus the
 * full design system surface. Used both by the renderer tests and the patch
 * tests below.
 */
const FIXTURE_PLAN: SlidePlan = SlidePlanSchema.parse({
  meta: {
    title: 'Knowledge Graphs for the Time-Constrained CTO',
    subtitle: 'When to invest, what to skip, and what it really costs.',
    author: 'DeckPilot',
    aspect: '16:9',
  },
  design: {
    accent: '1A2B5E',
    accentAlt: 'C8202E',
    tone: 'editorial',
    useKickers: true,
    useFooterBand: true,
    cardStyle: 'side-bar',
  },
  slides: [
    {
      id: 'cover',
      title: 'Knowledge Graphs',
      subtitle: 'A 7-slide decision framework',
      background: 'paper',
      notes: 'Open warm — promise practical guidance.',
    },
    {
      id: 'frame',
      kicker: 'The Frame',
      title: "It's a progression, not a choice",
      body: {
        kind: 'grid',
        columns: 4,
        items: [
          { number: '01', title: 'DATA', body: 'Raw, fragmented rows', accent: 'primary' },
          { number: '02', title: 'MEANING', body: 'Shared vocabulary', accent: 'primary' },
          { number: '03', title: 'KNOWLEDGE', body: 'Connected entities', accent: 'alt' },
          { number: '04', title: 'INTELLIGENCE', body: 'Autonomous reasoning', accent: 'alt' },
        ],
      },
      notes: 'Frame the progression.',
    },
    {
      id: 'plain',
      kicker: 'In Plain English',
      title: 'Two simple ideas',
      body: {
        kind: 'grid',
        columns: 2,
        items: [
          {
            kicker: 'Semantic Model',
            title: 'A shared dictionary.',
            body: 'Everyone agrees on the words and what they mean.',
            cta: 'lets you → search',
            glyph: 'table',
            accent: 'primary',
          },
          {
            kicker: 'Ontology',
            title: 'A map of meaning.',
            body: 'Captures how things relate.',
            cta: 'lets you → discover & reason',
            glyph: 'network',
            accent: 'alt',
          },
        ],
      },
      notes: 'Compare side by side.',
    },
    {
      id: 'workflow',
      kicker: 'How it works',
      title: 'From rows to reasoning',
      body: {
        kind: 'steps',
        items: [
          { number: '1', title: 'Model', description: 'Define shared vocabulary' },
          { number: '2', title: 'Link', description: 'Connect entities' },
          { number: '3', title: 'Reason', description: 'Run inference', accent: 'alt' },
        ],
      },
      notes: 'Walk the steps.',
    },
    {
      id: 'quote',
      body: {
        kind: 'quote',
        text: "Buy the database. Build the retrieval logic. Own the embeddings.",
        attribution: 'DeckPilot, on architectural rules of thumb',
      },
      notes: 'Land it, breathe, move on.',
    },
    {
      id: 'takeaway',
      body: {
        kind: 'callout',
        lead: 'Bottom line',
        statement: 'Every enterprise needs semantic models. Some workloads also need an ontology.',
      },
      notes: 'The chapter takeaway.',
    },
    {
      id: 'narrative',
      kicker: 'A Worked Example',
      title: 'Think of your music app',
      subtitle: 'Same data underneath. Three very different experiences.',
      body: {
        kind: 'prose',
        lead: 'Stages map cleanly onto how much meaning you choose to capture.',
        bullets: [
          { text: 'Just data: filename-level search', level: 0 },
          { text: 'Semantic: artist + album + tempo, joined and tagged', level: 0 },
          { text: 'Ontology: relationships, influences, mood vectors', level: 0 },
        ],
      },
      notes: 'Make it concrete.',
    },
  ],
});

describe('renderPlan (v0.5)', () => {
  it('writes a non-empty .pptx with one slide part per plan slide', async () => {
    const out = join(dir, 'kg.pptx');
    const abs = await renderPlan(FIXTURE_PLAN, out);
    expect(abs).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(15_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slidePaths = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    expect(slidePaths.length).toBe(FIXTURE_PLAN.slides.length);
  });

  it('emits speaker notes for slides with notes populated', async () => {
    const out = join(dir, 'notes.pptx');
    await renderPlan(FIXTURE_PLAN, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const notesSlides = Object.keys(zip.files).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    expect(notesSlides.length).toBeGreaterThan(0);
  });

  it('embeds the slide title text in slide-2 (the framework slide)', async () => {
    const out = join(dir, 'titles.pptx');
    await renderPlan(FIXTURE_PLAN, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    // OOXML escapes apostrophes, so check the unambiguous tail.
    expect(slide2).toContain('progression, not a choice');
  });

  it('renders cards (rounded-rect shapes) on grid slides', async () => {
    const out = join(dir, 'cards.pptx');
    await renderPlan(FIXTURE_PLAN, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    // Slide 2 is the 4-column grid. It should contain `roundRect` preset shape entries.
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    // pptxgenjs encodes shape preset as `prstGeom prst="roundRect"` (or similar)
    expect(slide2).toMatch(/roundRect/);
  });
});

describe('applySlidePatch (v0.5)', () => {
  it('patches a single slide field', () => {
    const { plan, slide } = applySlidePatch(FIXTURE_PLAN, 'cover', {
      title: 'Knowledge Graphs — A Pragmatic Guide',
    });
    expect(slide.title).toBe('Knowledge Graphs — A Pragmatic Guide');
    expect(plan.slides.find((s) => s.id === 'cover')?.title).toContain('Pragmatic Guide');
  });

  it('replaces a body composition atomically', () => {
    const { slide } = applySlidePatch(FIXTURE_PLAN, 'narrative', {
      body: {
        kind: 'callout',
        statement: 'Music apps live or die by their relationship graph.',
      },
    });
    expect(slide.body?.kind).toBe('callout');
  });

  it('errors on unknown slide id', () => {
    expect(() => applySlidePatch(FIXTURE_PLAN, 'nope', { title: 'x' })).toThrow(/No slide/);
  });
});
