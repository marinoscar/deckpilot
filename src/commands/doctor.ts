import { constants, accessSync } from 'node:fs';
import { BaseCommand } from '../cli/base-command.js';
import { checkCopilotSdk, checkGitHubToken } from '../copilot/readiness.js';
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

    checks.push(checkGitHubToken());

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

    checks.push(await checkCopilotSdk());

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
