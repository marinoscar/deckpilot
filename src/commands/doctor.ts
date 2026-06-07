import { constants, accessSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BaseCommand } from '../cli/base-command.js';
import { describeTokenSource, resolveGitHubToken } from '../copilot/auth.js';
import { createClient } from '../copilot/client.js';
import { isPreviewAvailable } from '../render/pptx-to-pngs.js';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
  /** Soft checks warn but don't make the overall exit fail. */
  soft?: boolean;
};

export default class Doctor extends BaseCommand {
  static override description =
    'Run preflight diagnostics: Node version, Copilot SDK reachable, auth/entitlement, write permissions.';

  static override examples = ['<%= config.bin %> doctor'];

  async run(): Promise<void> {
    const checks: Check[] = [];

    const major = Number.parseInt(process.versions.node.split('.')[0]!, 10);
    checks.push({
      name: 'Node ≥ 22',
      ok: major >= 22,
      detail: `node ${process.versions.node}`,
      hint: major >= 22 ? undefined : 'Upgrade Node (try `nvm install 22`).',
    });

    const token = resolveGitHubToken();
    // The Copilot SDK falls back to the Copilot CLI's keychain when no
    // explicit GitHub token is on env. Detect that fallback by probing for
    // ~/.copilot (Linux/macOS/WSL) OR %USERPROFILE%\.copilot (Windows).
    // Pre-v0.14.6 used process.env.HOME, which is unset on Windows — so the
    // check incorrectly reported missing even after `copilot login`.
    const copilotKeychainDir = join(homedir(), '.copilot');
    const hasCopilotKeychain = existsSync(copilotKeychainDir);
    checks.push({
      name: 'GitHub token resolvable',
      ok: token.source !== 'none' || hasCopilotKeychain,
      detail:
        hasCopilotKeychain && token.source === 'none'
          ? `source: copilot CLI keychain at ${copilotKeychainDir}`
          : `source: ${describeTokenSource(token.source)}`,
      hint:
        token.source === 'none' && !hasCopilotKeychain
          ? 'Run `deckpilot auth login` (or `copilot login`) to start the device-flow login.'
          : undefined,
    });

    try {
      accessSync(process.cwd(), constants.W_OK);
      checks.push({ name: 'cwd writable', ok: true, detail: process.cwd() });
    } catch {
      checks.push({
        name: 'cwd writable',
        ok: false,
        detail: process.cwd(),
        hint: 'Change to a directory you have write access to.',
      });
    }

    let sdkOk = false;
    let sdkDetail = '';
    try {
      const dp = createClient();
      await dp.start();
      const pong = await dp.client.ping('deckpilot doctor');
      sdkOk = !!pong;
      sdkDetail = `ping ok at ${pong.timestamp}`;
      await dp.stop();
    } catch (e) {
      sdkDetail = `start/ping failed: ${(e as Error).message}`;
    }
    checks.push({
      name: 'Copilot SDK reachable',
      ok: sdkOk,
      detail: sdkDetail,
      hint: sdkOk
        ? undefined
        : 'Most likely an auth or entitlement issue. Run `deckpilot auth login`. If you have no Copilot subscription, visit https://github.com/settings/copilot.',
    });

    // Visual preview pipeline — pure-JS (pptx-glimpse), bundled as a dependency,
    // so it needs no external binaries. Soft check kept for parity/visibility.
    const previewOk = await isPreviewAvailable();
    checks.push({
      name: 'Visual critique pipeline',
      ok: previewOk,
      detail: previewOk
        ? 'pure-JS preview (pptx-glimpse) — no external binaries needed'
        : 'pptx-glimpse renderer not loadable',
      soft: true,
      hint: previewOk
        ? undefined
        : 'Reinstall dependencies (`npm install`) — pptx-glimpse should be present.',
    });

    for (const c of checks) {
      const mark = c.ok ? '✓' : c.soft ? '!' : '✗';
      const color = c.ok ? '\x1b[32m' : c.soft ? '\x1b[33m' : '\x1b[31m';
      this.log(`${color}${mark}\x1b[0m ${c.name} — ${c.detail}`);
      if (!c.ok && c.hint) this.log(`    hint: ${c.hint}`);
    }

    // Soft checks don't fail the exit; only hard failures do.
    const allHardOk = checks.every((c) => c.ok || c.soft);
    if (!allHardOk) this.exit(1);
  }
}
