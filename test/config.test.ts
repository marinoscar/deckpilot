import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigSchema,
  InvalidConfigKeyError,
  InvalidConfigValueError,
  canonicalKey,
  configPath,
  emptyConfig,
  getConfigValue,
  loadConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from '../src/store/config.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-config-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  process.env.DECKPILOT_HOME = mkdtempSync(join(root, 'home-'));
});

describe('ConfigSchema', () => {
  it('accepts a fresh empty config and applies defaults', () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.schemaVersion).toBe('1.0');
    expect(cfg.defaults).toEqual({});
  });

  it('rejects unknown top-level keys', () => {
    expect(() => ConfigSchema.parse({ unknown: true })).toThrow();
  });

  it('rejects unknown keys inside defaults', () => {
    expect(() => ConfigSchema.parse({ defaults: { somethingElse: 1 } })).toThrow();
  });

  it('rejects critiquePassesPerSlide outside 0..5', () => {
    expect(() => ConfigSchema.parse({ defaults: { critiquePassesPerSlide: -1 } })).toThrow();
    expect(() => ConfigSchema.parse({ defaults: { critiquePassesPerSlide: 6 } })).toThrow();
  });

  it('rejects template names with bad characters', () => {
    expect(() => ConfigSchema.parse({ defaults: { template: 'Bad Name' } })).toThrow();
    expect(() => ConfigSchema.parse({ defaults: { template: 'acme' } })).not.toThrow();
  });
});

describe('load/save', () => {
  it('loadConfig returns emptyConfig() when file is absent', async () => {
    const cfg = await loadConfig();
    expect(cfg).toEqual(emptyConfig());
    expect(existsSync(configPath())).toBe(false);
  });

  it('saveConfig + loadConfig roundtrips through the canonical schema', async () => {
    const initial = setConfigValue(emptyConfig(), 'defaults.model', 'gpt-5');
    await saveConfig(initial);
    const reloaded = await loadConfig();
    expect(reloaded.defaults.model).toBe('gpt-5');
  });

  it('saveConfig writes atomically and a JSON file with a trailing newline', async () => {
    await saveConfig(emptyConfig());
    const text = await readFile(configPath(), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('saveConfig writes under DECKPILOT_HOME for cross-platform tests', async () => {
    await saveConfig(emptyConfig());
    expect(configPath().startsWith(process.env.DECKPILOT_HOME ?? '')).toBe(true);
    expect(existsSync(configPath())).toBe(true);
  });

  it('loadConfig throws on corrupt JSON', async () => {
    await saveConfig(emptyConfig());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(configPath(), '{not json');
    await expect(loadConfig()).rejects.toThrow(/not valid JSON/);
  });
});

describe('canonicalKey aliases', () => {
  it('maps friendly aliases to canonical dotted paths', () => {
    expect(canonicalKey('critique-passes')).toBe('defaults.critiquePassesPerSlide');
    expect(canonicalKey('CRITIQUE-PASSES')).toBe('defaults.critiquePassesPerSlide');
    expect(canonicalKey('model')).toBe('defaults.model');
    expect(canonicalKey('template')).toBe('defaults.template');
  });

  it('leaves canonical paths unchanged', () => {
    expect(canonicalKey('defaults.model')).toBe('defaults.model');
  });
});

describe('get/set/unset', () => {
  it('setConfigValue coerces numeric strings for critique passes', () => {
    const cfg = setConfigValue(emptyConfig(), 'critique-passes', '4');
    expect(cfg.defaults.critiquePassesPerSlide).toBe(4);
  });

  it('setConfigValue rejects non-numeric strings for critique passes', () => {
    expect(() => setConfigValue(emptyConfig(), 'critique-passes', 'lots')).toThrow(
      InvalidConfigValueError,
    );
  });

  it('setConfigValue rejects out-of-range critique passes via the schema', () => {
    expect(() => setConfigValue(emptyConfig(), 'critique-passes', '9')).toThrow(
      InvalidConfigValueError,
    );
  });

  it('setConfigValue rejects malformed template names', () => {
    expect(() => setConfigValue(emptyConfig(), 'template', 'Bad Name')).toThrow(
      InvalidConfigValueError,
    );
  });

  it('setConfigValue rejects unknown keys', () => {
    expect(() => setConfigValue(emptyConfig(), 'defaults.weird', 'x')).toThrow(
      InvalidConfigKeyError,
    );
  });

  it('getConfigValue returns undefined for unset keys', () => {
    expect(getConfigValue(emptyConfig(), 'model')).toBeUndefined();
  });

  it('unsetConfigValue removes a previously set value', () => {
    const cfg = setConfigValue(emptyConfig(), 'model', 'gpt-5');
    expect(getConfigValue(cfg, 'model')).toBe('gpt-5');
    const cleared = unsetConfigValue(cfg, 'model');
    expect(getConfigValue(cleared, 'model')).toBeUndefined();
  });
});
