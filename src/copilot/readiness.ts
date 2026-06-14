/**
 * Copilot readiness probes — "is GitHub Copilot installed, signed in, and
 * ready?". Shared by `deckpilot doctor` (CLI) and the TUI first-run gate
 * (`src/ui/screens/CopilotCheck.tsx`) so both report the exact same checks
 * and never drift.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describeTokenSource, resolveGitHubToken } from './auth.js';
import { createClient } from './client.js';

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
};

export type CopilotReadiness = {
  /** True only when a credential is present AND the SDK pings successfully. */
  ok: boolean;
  token: ReadinessCheck;
  sdk: ReadinessCheck;
};

const LOGIN_HINT =
  'Run `deckpilot auth login` (or `copilot login`) to start the GitHub device-flow login.';
const ENTITLEMENT_HINT =
  'Most likely an auth or entitlement issue. Run `deckpilot auth login`. No Copilot subscription? See https://github.com/settings/copilot.';

/**
 * Is a GitHub token discoverable? Either an env var resolves one, or the
 * Copilot CLI keychain (`~/.copilot`, `%USERPROFILE%\.copilot` on Windows)
 * exists for the SDK to fall back on. Pure/local — no network.
 */
export function checkGitHubToken(explicit?: string): ReadinessCheck {
  const token = resolveGitHubToken(explicit);
  // The Copilot SDK falls back to the Copilot CLI's keychain when no explicit
  // GitHub token is on env. Detect that fallback by probing for the keychain
  // dir via homedir() (works on Linux/macOS/WSL and Windows alike).
  const keychainDir = join(homedir(), '.copilot');
  const hasKeychain = existsSync(keychainDir);
  const ok = token.source !== 'none' || hasKeychain;
  return {
    name: 'GitHub token resolvable',
    ok,
    detail:
      hasKeychain && token.source === 'none'
        ? `source: Copilot CLI keychain at ${keychainDir}`
        : `source: ${describeTokenSource(token.source)}`,
    hint: ok ? undefined : LOGIN_HINT,
  };
}

/**
 * Start the Copilot SDK and ping it. A successful pong proves the token is
 * valid AND the account is Copilot-entitled AND the service is reachable —
 * the strongest "ready" signal short of opening a chat session.
 */
export async function checkCopilotSdk(explicit?: string): Promise<ReadinessCheck> {
  try {
    const dp = createClient(explicit ? { gitHubToken: explicit } : {});
    await dp.start();
    const pong = await dp.client.ping('deckpilot readiness');
    await dp.stop();
    return {
      name: 'Copilot signed in & ready',
      ok: !!pong,
      detail: pong ? `ping ok at ${pong.timestamp}` : 'no response from Copilot',
      hint: pong ? undefined : ENTITLEMENT_HINT,
    };
  } catch (e) {
    return {
      name: 'Copilot signed in & ready',
      ok: false,
      detail: `start/ping failed: ${(e as Error).message}`,
      hint: ENTITLEMENT_HINT,
    };
  }
}

/**
 * Combined Copilot readiness used by the TUI first-run gate. Short-circuits
 * the network probe when no credential exists at all, so a logged-out user
 * gets an instant, clear answer instead of waiting on a doomed ping.
 */
export async function checkCopilotReadiness(explicit?: string): Promise<CopilotReadiness> {
  const token = checkGitHubToken(explicit);
  if (!token.ok) {
    return {
      ok: false,
      token,
      sdk: {
        name: 'Copilot signed in & ready',
        ok: false,
        detail: 'skipped — no GitHub token found',
        hint: LOGIN_HINT,
      },
    };
  }
  const sdk = await checkCopilotSdk(explicit);
  return { ok: token.ok && sdk.ok, token, sdk };
}
