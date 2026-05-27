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

const FIXTURE_PLAN: SlidePlan = SlidePlanSchema.parse({
  meta: { title: 'Vector Databases for the Time-Constrained CTO', author: 'DeckPilot' },
  slides: [
    {
      id: 'title',
      layout: 'title',
      title: 'Vector Databases',
      subtitle: 'What they are, when to use them, and what they cost.',
      author: 'DeckPilot',
      date: '2026-05-27',
      notes: 'Open by acknowledging vector dbs are hyped — promise practical guidance.',
    },
    {
      id: 'sec-why',
      layout: 'section',
      title: 'Why now',
      number: '01',
      notes: 'Bridge from generative AI surge to retrieval needs.',
    },
    {
      id: 'why',
      layout: 'content',
      title: 'Why now',
      body: [
        { text: 'LLM apps need to ground answers in private data', level: 0 },
        { text: 'Keyword search misses semantic similarity', level: 0 },
        { text: 'Embeddings cheap, but querying them at scale is not', level: 0 },
      ],
      notes: 'Frame this as a retrieval problem, not a database fad.',
    },
    {
      id: 'options',
      layout: 'two-col',
      title: 'Build vs buy',
      left: {
        heading: 'Roll your own',
        body: [
          { text: 'pgvector — bolt onto your existing Postgres', level: 0 },
          { text: 'Cheap, familiar, slow at >10M vectors', level: 0 },
        ],
      },
      right: {
        heading: 'Managed',
        body: [
          { text: 'Pinecone, Weaviate Cloud, Turbopuffer', level: 0 },
          { text: 'Auto-shard, replicate, hybrid search included', level: 0 },
        ],
      },
      notes: 'Anchor to the 10M vector breakpoint as decision threshold.',
    },
    {
      id: 'quote',
      layout: 'quote',
      quote: 'Buy the database. Build the retrieval logic. Own the embeddings.',
      attribution: 'DeckPilot, on architectural rules of thumb',
    },
    {
      id: 'closing',
      layout: 'closing',
      title: 'Thanks.',
      subtitle: 'Questions about retrieval, ranking, or cost?',
      contact: 'oscar@marin.cr',
    },
  ],
});

describe('renderPlan', () => {
  it('writes a valid .pptx with one ppt/slides/slideN.xml per plan slide', async () => {
    const out = join(dir, 'vector-dbs.pptx');
    const abs = await renderPlan(FIXTURE_PLAN, out);
    expect(abs).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(15_000);

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slidePaths = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    expect(slidePaths.length).toBe(FIXTURE_PLAN.slides.length);

    // Speaker notes are required by our system prompt — confirm at least one
    // notesSlide is emitted (pptxgenjs only adds them when addNotes is called).
    const notesSlides = Object.keys(zip.files).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    expect(notesSlides.length).toBeGreaterThan(0);
  });

  it('embeds the slide title text in the rendered OOXML', async () => {
    const out = join(dir, 'title-check.pptx');
    await renderPlan(FIXTURE_PLAN, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide1).toContain('Vector Databases');
  });
});

describe('applySlidePatch', () => {
  it('patches a single content slide and rejects layout-incompatible edits', () => {
    const { plan, slide } = applySlidePatch(FIXTURE_PLAN, 'why', {
      title: 'Why now — and why this changes everything',
    });
    expect(slide.layout).toBe('content');
    expect(plan.slides.find((s) => s.id === 'why')?.title).toContain('changes everything');

    expect(() =>
      applySlidePatch(FIXTURE_PLAN, 'title', {
        body: [{ text: 'this should fail', level: 0 }],
      }),
    ).toThrow();
  });

  it('errors on unknown slide id', () => {
    expect(() => applySlidePatch(FIXTURE_PLAN, 'nope', { title: 'x' })).toThrow(/No slide/);
  });
});
