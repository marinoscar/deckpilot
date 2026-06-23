/**
 * "Is a newer DeckPilot available?" — a best-effort, non-blocking check against
 * the version recorded in `package.json` on the main branch. The result is
 * cached in `~/.deckpilot/config.json` and refreshed at most once a day so
 * startup never pays for the network twice. Every failure path returns `null`
 * (or no update) — this must never throw or block the CLI/TUI.
 */
import { loadUpdateCache, saveUpdateCache } from '../store/config.js';

/** Raw `package.json` on the default branch — the source of truth for "latest". */
export const LATEST_PKG_URL =
  'https://raw.githubusercontent.com/marinoscar/deckpilot/main/package.json';

/** Refresh the cached latest-version at most once per this window. */
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export type UpdateInfo = { latest: string; current: string };

/**
 * Fetch the `version` field from the main-branch `package.json`. Returns `null`
 * on any network/parse error or non-200 response, after `timeoutMs`.
 */
export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  try {
    const res = await fetch(LATEST_PKG_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' && data.version.trim() ? data.version.trim() : null;
  } catch {
    return null;
  }
}

/** Split "1.3.5" / "v1.3.5" / "1.3.5-beta.1" into numeric core segments. */
function parseVersion(v: string): number[] | null {
  const core = v.trim().replace(/^v/i, '').split('-')[0] ?? '';
  const parts = core.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

/** True when `latest` is a strictly higher semver than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Resolve update info for the running version, using the daily cache when it is
 * still fresh and only hitting the network otherwise. Returns `null` when up to
 * date, when the check is disabled (`DECKPILOT_NO_UPDATE_CHECK`), or on error.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  if (process.env.DECKPILOT_NO_UPDATE_CHECK) return null;

  const cache = await loadUpdateCache();
  const fresh =
    typeof cache.lastCheckTime === 'number' && Date.now() - cache.lastCheckTime < CHECK_TTL_MS;

  let latest: string | null;
  if (fresh && cache.latestVersion) {
    latest = cache.latestVersion;
  } else {
    latest = await fetchLatestVersion();
    if (latest) await saveUpdateCache(latest);
  }

  if (latest && isNewerVersion(latest, currentVersion)) {
    return { latest, current: currentVersion };
  }
  return null;
}
