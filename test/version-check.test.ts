import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, fetchLatestVersion, isNewerVersion } from '../src/util/version-check.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isNewerVersion', () => {
  it('detects a strictly higher version across each segment', () => {
    expect(isNewerVersion('1.3.5', '1.3.4')).toBe(true);
    expect(isNewerVersion('1.4.0', '1.3.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false when equal or older', () => {
    expect(isNewerVersion('1.3.4', '1.3.4')).toBe(false);
    expect(isNewerVersion('1.3.3', '1.3.4')).toBe(false);
    expect(isNewerVersion('1.2.9', '1.3.0')).toBe(false);
  });

  it('tolerates a leading v and differing segment counts', () => {
    expect(isNewerVersion('v1.3.5', '1.3.4')).toBe(true);
    expect(isNewerVersion('1.4', '1.3.9')).toBe(true);
    expect(isNewerVersion('1.3', '1.3.0')).toBe(false);
  });

  it('ignores prerelease suffixes and returns false on garbage', () => {
    expect(isNewerVersion('1.3.5-beta.1', '1.3.5')).toBe(false);
    expect(isNewerVersion('not-a-version', '1.3.4')).toBe(false);
    expect(isNewerVersion('1.3.5', 'nope')).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  it('parses the version field from a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: '1.4.0' }), { status: 200 })),
    );
    expect(await fetchLatestVersion()).toBe('1.4.0');
  });

  it('returns null on a non-200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null when version is missing or blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'deckpilot' }), { status: 200 })),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('is disabled by DECKPILOT_NO_UPDATE_CHECK without touching the network', async () => {
    vi.stubEnv('DECKPILOT_NO_UPDATE_CHECK', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await checkForUpdate('1.3.4')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
