import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TemplateExistsError,
  TemplateNotFoundError,
  deleteTemplate,
  listTemplates,
  loadTemplate,
  saveTemplate,
} from '../src/store/templates.js';
import { TemplateSpecSchema, blankTemplate, summarizeTemplate } from '../src/template/spec.js';

describe('TemplateSpecSchema', () => {
  it('accepts a minimal spec with palette + fonts', () => {
    const parsed = TemplateSpecSchema.safeParse({
      name: 'minimal',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.schemaVersion).toBe('1.0');
      expect(parsed.data.theme.tone).toBe('editorial');
    }
  });

  it('rejects names with invalid characters', () => {
    const result = TemplateSpecSchema.safeParse({
      name: 'Acme Corp!',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects asset paths that escape the template dir', () => {
    const result = TemplateSpecSchema.safeParse({
      name: 'escape',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
      assets: { logo: '../etc/passwd' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects absolute asset paths', () => {
    const result = TemplateSpecSchema.safeParse({
      name: 'abs',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
      assets: { logo: '/var/log/system.log' },
    });
    expect(result.success).toBe(false);
  });

  it('caps guidance at 4KB', () => {
    const result = TemplateSpecSchema.safeParse({
      name: 'huge',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
      guidance: 'x'.repeat(5000),
    });
    expect(result.success).toBe(false);
  });
});

describe('blankTemplate', () => {
  it('produces a valid spec', () => {
    const spec = blankTemplate('starter');
    expect(spec.name).toBe('starter');
    expect(TemplateSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe('summarizeTemplate', () => {
  it('emits a one-line summary with palette and fonts', () => {
    const spec = blankTemplate('starter');
    const summary = summarizeTemplate(spec);
    expect(summary).toContain('starter');
    expect(summary).toContain('#1A2B5E');
    expect(summary).toContain('Inter Tight');
  });
});

describe('template store (round-trip)', () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'deckpilot-templates-'));
    process.env.DECKPILOT_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.DECKPILOT_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('saves and loads a template', async () => {
    const spec = blankTemplate('acme');
    await saveTemplate(spec);
    const loaded = await loadTemplate('acme');
    expect(loaded.name).toBe('acme');
    expect(loaded.theme.accent).toBe(spec.theme.accent);
    expect(loaded.rootDir).toBe(join(tmpHome, 'templates', 'acme'));
  });

  it('refuses to overwrite an existing template by default', async () => {
    const spec = blankTemplate('once');
    await saveTemplate(spec);
    await expect(saveTemplate(spec)).rejects.toThrow(TemplateExistsError);
  });

  it('overwrites when overwrite=true', async () => {
    const spec = blankTemplate('rewrite');
    await saveTemplate(spec);
    await saveTemplate({ ...spec, description: 'changed' }, { overwrite: true });
    const loaded = await loadTemplate('rewrite');
    expect(loaded.description).toBe('changed');
  });

  it('listTemplates returns all valid templates sorted', async () => {
    await saveTemplate(blankTemplate('zebra'));
    await saveTemplate(blankTemplate('alpha'));
    const entries = await listTemplates();
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'zebra']);
  });

  it('throws TemplateNotFoundError for missing templates', async () => {
    await expect(loadTemplate('ghost')).rejects.toThrow(TemplateNotFoundError);
  });

  it('deletes a template and its directory', async () => {
    await saveTemplate(blankTemplate('doomed'));
    await deleteTemplate('doomed');
    await expect(loadTemplate('doomed')).rejects.toThrow(TemplateNotFoundError);
  });

  it('drops missing-file logos silently on load (defensive)', async () => {
    const spec = TemplateSpecSchema.parse({
      name: 'broken-logo',
      theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
      assets: { logo: 'assets/never-existed.png' },
    });
    await saveTemplate(spec);
    const loaded = await loadTemplate('broken-logo');
    expect(loaded.assets?.logo).toBeUndefined();
  });
});

describe('TemplateSpec — master / paletteSamples / donorGeometry (v0.16)', () => {
  const base = {
    name: 'rich',
    theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
  };

  it('accepts a master with a solid background and a single rect object', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: {
        background: { type: 'solid', color: '0A1A3E' },
        objects: [{ kind: 'rect', x: 12, y: 0, w: 1.333, h: 7.5, fill: '000000' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a master with an image background and an image object', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: {
        background: { type: 'image', src: 'assets/master-background.png' },
        objects: [
          { kind: 'image', src: 'assets/master-image-0.png', x: 0.4, y: 0.3, w: 1.2, h: 0.6 },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a master with no background AND no objects', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: { objects: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a master image object whose src tries to escape', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: {
        objects: [{ kind: 'image', src: '../etc/passwd', x: 0, y: 0, w: 1, h: 1 }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown master object kinds', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: {
        objects: [{ kind: 'circle', x: 0, y: 0, w: 1, h: 1, fill: '000000' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad hex colours in master.background.solid', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      master: { background: { type: 'solid', color: 'NOTHEX' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts paletteSamples up to 12 entries', () => {
    const samples = Array.from({ length: 12 }, (_, i) =>
      i.toString(16).padStart(6, '0').toUpperCase(),
    );
    const result = TemplateSpecSchema.safeParse({ ...base, paletteSamples: samples });
    expect(result.success).toBe(true);
  });

  it('rejects paletteSamples with more than 12 entries', () => {
    const samples = Array.from({ length: 13 }, () => 'AABBCC');
    const result = TemplateSpecSchema.safeParse({ ...base, paletteSamples: samples });
    expect(result.success).toBe(false);
  });

  it('rejects paletteSamples containing non-hex strings', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      paletteSamples: ['AABBCC', 'rgb(0,0,0)'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a donorGeometry entry with named shapes', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      donorGeometry: [
        {
          index: 0,
          name: 'Cover',
          layoutName: 'Title Slide',
          summary: 'Cover with photo bg + title bottom-left',
          shapes: [
            {
              name: 'Title',
              kind: 'text',
              x: 0.6,
              y: 5.5,
              w: 12,
              h: 1.2,
              placeholder: 'Title',
              fontFace: 'Inter Tight',
              fontSize: 56,
              bold: true,
              textColor: 'FFFFFF',
              sampleText: 'Knowledge graphs',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('defaults donorGeometry[].summary to an empty string when omitted', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      donorGeometry: [
        { index: 0, name: 'Slide 1', shapes: [] },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.donorGeometry?.[0].summary).toBe('');
    }
  });

  it('caps donorGeometry shape array at 6 entries', () => {
    const tooManyShapes = Array.from({ length: 7 }, (_, i) => ({
      name: `Shape${i}`,
      kind: 'text' as const,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    }));
    const result = TemplateSpecSchema.safeParse({
      ...base,
      donorGeometry: [{ index: 0, name: 'Crowded', shapes: tooManyShapes }],
    });
    expect(result.success).toBe(false);
  });

  it('caps donorGeometry array at 40 entries', () => {
    const tooManyDonors = Array.from({ length: 41 }, (_, i) => ({
      index: i,
      name: `Slide ${i}`,
      shapes: [],
    }));
    const result = TemplateSpecSchema.safeParse({ ...base, donorGeometry: tooManyDonors });
    expect(result.success).toBe(false);
  });

  it('rejects donorGeometry shape kinds outside the allowed enum', () => {
    const result = TemplateSpecSchema.safeParse({
      ...base,
      donorGeometry: [
        {
          index: 0,
          name: 'Slide 1',
          shapes: [{ name: 'Mystery', kind: 'video' as never, x: 0, y: 0, w: 1, h: 1 }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
