import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkGitHubToken } from '../src/copilot/readiness.js';
import {
  emptyConfig,
  isCopilotOnboarded,
  loadConfig,
  markCopilotOnboarded,
  saveConfig,
  setConfigValue,
} from '../src/store/config.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-onboarding-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  process.env.DECKPILOT_HOME = mkdtempSync(join(root, 'home-'));
});

describe('copilot onboarding flag', () => {
  it('defaults to not-onboarded when no config exists', async () => {
    expect(await isCopilotOnboarded()).toBe(false);
  });

  it('markCopilotOnboarded persists and isCopilotOnboarded reflects it', async () => {
    await markCopilotOnboarded();
    expect(await isCopilotOnboarded()).toBe(true);
    const cfg = await loadConfig();
    expect(cfg.onboarding.copilotReady).toBe(true);
  });

  it('markCopilotOnboarded is idempotent', async () => {
    await markCopilotOnboarded();
    await markCopilotOnboarded();
    expect(await isCopilotOnboarded()).toBe(true);
  });

  it('changing a setting preserves the onboarding flag', async () => {
    await markCopilotOnboarded();
    const cfg = await loadConfig();
    const updated = setConfigValue(cfg, 'model', 'gpt-5');
    await saveConfig(updated);
    const reloaded = await loadConfig();
    expect(reloaded.defaults.model).toBe('gpt-5');
    expect(reloaded.onboarding.copilotReady).toBe(true);
  });

  it('emptyConfig is not onboarded', () => {
    expect(emptyConfig().onboarding.copilotReady).toBe(false);
  });
});

describe('checkGitHubToken', () => {
  it('reports ok for an explicit token', () => {
    const r = checkGitHubToken('ghp_explicit');
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('explicitly provided');
    expect(r.hint).toBeUndefined();
  });

  it('reports ok when a GitHub token is on the environment', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_env');
    try {
      const r = checkGitHubToken();
      expect(r.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
