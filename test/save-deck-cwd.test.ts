import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type DeckBrief, DeckBriefSchema } from '../src/deck/brief.js';
import { type DeckToolContext, buildDeckTools } from '../src/tools/index.js';

const FIXTURE_BRIEF: DeckBrief = DeckBriefSchema.parse({
  meta: { title: 'cwd hygiene test', author: 'DeckPilot' },
  theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
  slides: [
    { id: 'cover', title: 'Cover', purpose: 'cover.' },
    { id: 'body', title: 'Body', purpose: 'body.' },
  ],
});

const FIXTURE_CODE = new Map<string, string>([
  [
    'cover',
    `function render(slide, theme) {
      slide.background = { color: theme.accent };
      slide.addText('Cover', { x: 0.6, y: 2, w: 12, h: 2, fontSize: 60 });
    }`,
  ],
  [
    'body',
    `function render(slide, theme) {
      slide.background = { color: theme.paper };
      slide.addText('Body', { x: 0.6, y: 0.6, w: 12, h: 1, fontSize: 32 });
    }`,
  ],
]);

const root = mkdtempSync(join(tmpdir(), 'deckpilot-save-cwd-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeCtx(outputPath: string): DeckToolContext {
  return {
    getBrief: () => FIXTURE_BRIEF,
    setBrief: () => {},
    getSlideCode: (id) => FIXTURE_CODE.get(id) ?? null,
    setSlideCode: () => {},
    getAllSlideCode: () => FIXTURE_CODE,
    defaultOutputPath: () => outputPath,
    getTemplate: () => null,
    loadTemplate: async () => {
      throw new Error('not used');
    },
    useNamedTemplate: async () => {},
    getActiveTemplateName: () => undefined,
    critiquePassesPerSlide: () => 0,
    consumeCritiquePass: () => ({ remaining: 0, allowed: false }),
    previewFailureReason: () => null,
    notePreviewUnavailable: () => {},
    recordPreview: async () => ({ pngPath: '', pass: 0 }),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: tool handler types are SDK-internal
async function runSaveDeck(tools: any, args: Record<string, unknown>) {
  const tool = tools.find((t: { name: string }) => t.name === 'save_deck');
  expect(tool).toBeDefined();
  // SDK validates+coerces the args. Re-parse via the tool's schema so defaults apply.
  const parsed = tool.parameters.parse(args);
  return tool.handler(parsed);
}

describe('save_deck cwd hygiene', () => {
  it('writes only the .pptx to the working dir by default', async () => {
    const cwd = mkdtempSync(join(root, 'default-'));
    const out = join(cwd, 'deck.pptx');
    const tools = buildDeckTools(makeCtx(out));
    const res = await runSaveDeck(tools, { outputPath: out });
    expect(res.ok).toBe(true);
    const entries = readdirSync(cwd);
    expect(entries).toEqual(['deck.pptx']);
    expect(existsSync(join(cwd, 'deck.brief.json'))).toBe(false);
    expect(existsSync(join(cwd, 'deck.cover.slide.ts'))).toBe(false);
    expect(existsSync(join(cwd, 'deck.body.slide.ts'))).toBe(false);
  });

  it('emits sidecar brief.json + .slide.ts files when includeSources: true', async () => {
    const cwd = mkdtempSync(join(root, 'opt-in-'));
    const out = join(cwd, 'deck.pptx');
    const tools = buildDeckTools(makeCtx(out));
    const res = await runSaveDeck(tools, { outputPath: out, includeSources: true });
    expect(res.ok).toBe(true);
    expect(existsSync(join(cwd, 'deck.pptx'))).toBe(true);
    expect(existsSync(join(cwd, 'deck.brief.json'))).toBe(true);
    expect(existsSync(join(cwd, 'deck.cover.slide.ts'))).toBe(true);
    expect(existsSync(join(cwd, 'deck.body.slide.ts'))).toBe(true);
  });
});
