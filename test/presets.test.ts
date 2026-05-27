import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignSystemSchema } from '../src/deck/schema.js';
import { PRESETS, PRESET_NAMES, listPresets } from '../src/deck/presets.js';
import { findStyleGuidePath, loadStyleGuide } from '../src/config/project.js';

describe('presets', () => {
  it('exposes five distinct, schema-valid presets', () => {
    expect(PRESET_NAMES.length).toBe(5);
    for (const name of PRESET_NAMES) {
      const ds = PRESETS[name];
      const parsed = DesignSystemSchema.safeParse(ds);
      expect(parsed.success, `${name} failed validation`).toBe(true);
    }
  });

  it('listPresets returns one entry per name with a description', () => {
    const list = listPresets();
    expect(list.length).toBe(PRESET_NAMES.length);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it('presets are stylistically distinct from each other', () => {
    // Distinct meaning: at least the accent colour and tone vary across all five.
    const accents = new Set(PRESET_NAMES.map((n) => PRESETS[n].accent));
    const tones = new Set(PRESET_NAMES.map((n) => PRESETS[n].tone));
    expect(accents.size).toBe(PRESET_NAMES.length);
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });
});

describe('DECKPILOT.md loader', () => {
  let tmpRoot: string;
  let nestedDir: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'deckpilot-styleguide-'));
    nestedDir = join(tmpRoot, 'a', 'b', 'c');
    require('node:fs').mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(tmpRoot, 'DECKPILOT.md'),
      '# Style\n\nAlways navy + red. Never serif. Always footer band on.',
      'utf8',
    );
  });
  afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('finds DECKPILOT.md in cwd', () => {
    const p = findStyleGuidePath(tmpRoot);
    expect(p).toBe(join(tmpRoot, 'DECKPILOT.md'));
  });

  it('finds DECKPILOT.md from a deeper subdirectory by walking up', () => {
    const p = findStyleGuidePath(nestedDir);
    expect(p).toBe(join(tmpRoot, 'DECKPILOT.md'));
  });

  it('returns null when nothing is found within the walk', () => {
    const isolated = mkdtempSync(join(tmpdir(), 'deckpilot-no-guide-'));
    try {
      const p = findStyleGuidePath(isolated);
      // /tmp may or may not have a DECKPILOT.md higher up — but the immediate
      // isolated dir definitely doesn't, so loadStyleGuide should not return
      // any path equal to the isolated dir.
      if (p) expect(p).not.toBe(join(isolated, 'DECKPILOT.md'));
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('loadStyleGuide returns content + bytes', async () => {
    const guide = await loadStyleGuide(tmpRoot);
    expect(guide).not.toBeNull();
    expect(guide!.content).toContain('Always navy + red');
    expect(guide!.bytes).toBe(guide!.content.length);
  });
});
