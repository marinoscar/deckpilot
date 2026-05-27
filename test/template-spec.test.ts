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
