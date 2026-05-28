import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { templateFromPptx } from '../src/template/from-pptx.js';
import { TemplateSpecSchema } from '../src/template/spec.js';

/**
 * The vision-driven `extractTemplateFromPptx` orchestrator needs a real
 * Copilot SDK session + LibreOffice + an authenticated GitHub token. None
 * of those are available on CI. Instead we test:
 *
 *   - The schema-shape contract that the LLM is expected to produce.
 *   - The shallow OOXML fallback path, which has no external deps.
 *   - The TemplateSpec the extractor session would WRITE (via save_template)
 *     validates cleanly when the LLM emits the canonical fields.
 *
 * End-to-end vision testing happens via the manual smoke checks in the plan.
 */
describe('templateFromPptx (shallow fallback path)', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'deckpilot-extract-test-'));
    process.env.DECKPILOT_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.DECKPILOT_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('rejects a missing pptx with a clear error', async () => {
    await expect(templateFromPptx('ghost', '/no/such/file.pptx')).rejects.toThrow();
  });

  it('rejects a non-pptx file (anything that JSZip cannot open)', async () => {
    const fake = join(tmpHome, 'not-a-pptx.pptx');
    writeFileSync(fake, 'this is not a zip file');
    await expect(templateFromPptx('bogus', fake)).rejects.toThrow();
  });
});

describe('TemplateSpec contract for the extractor', () => {
  it('accepts the rich shape the vision extractor is expected to emit', () => {
    // Mirror what the LLM would produce: dense guidance, voice + copy
    // rules, palette + fonts. Validates cleanly through the schema.
    const sample = {
      name: 'acme-luxe',
      brand: 'Acme Luxe',
      description: 'A black-and-gold premium jewellery brand.',
      theme: {
        accent: '0A0A0A',
        accentAlt: 'C9A961',
        ink: '1A1A1A',
        muted: '7C7C7C',
        paper: 'FAFAF7',
        fontHeading: 'Playfair Display',
        fontBody: 'Inter',
        tone: 'luxe' as const,
        aspect: '16:9' as const,
      },
      voiceHints:
        'Restrained, declarative. Sentence case with terminal periods. Never marketing puffery.',
      copyRules: '- Always capitalise "Diamond".\n- Never use "luxury" — say "fine".',
      guidance: [
        'Covers: full-bleed black with a single 64pt title bottom-left in gold,',
        'a hair-thin gold rule at y=6.0 underlining a tracked-out date eyebrow.',
        'Body slides: 1.5\\" top margin, kicker 11pt tracked +120 in muted gold,',
        'title 44pt heading, generous breathing room — never crowd the page.',
        'Numbers used as visual hooks at 96pt in accentAlt with subscript units.',
      ].join(' '),
    };
    const parsed = TemplateSpecSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it('rejects emitted specs with the wrong tone enum value', () => {
    const bad = {
      name: 'bad-tone',
      theme: {
        accent: '1A2B5E',
        accentAlt: 'C8202E',
        tone: 'minimalist' as unknown as 'minimal',
      },
    };
    const parsed = TemplateSpecSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('caps the guidance field at 4KB', () => {
    const huge = {
      name: 'huge',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
      guidance: 'x'.repeat(5000),
    };
    const parsed = TemplateSpecSchema.safeParse(huge);
    expect(parsed.success).toBe(false);
  });
});
