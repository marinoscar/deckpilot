import { existsSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { describeTokenSource, resolveGitHubToken } from '../copilot/auth.js';

const exec = promisify(execFile);

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
      name: 'Node ≥ 20',
      ok: major >= 20,
      detail: `node ${process.versions.node}`,
      hint: major >= 20 ? undefined : 'Upgrade Node (try `nvm install 22`).',
    });

    const token = resolveGitHubToken();
    checks.push({
      name: 'GitHub token resolvable',
      ok: token.source !== 'none' || existsSync(join(process.env.HOME ?? '', '.copilot')),
      detail: `source: ${describeTokenSource(token.source)}`,
      hint:
        token.source === 'none'
          ? 'Run `deckpilot auth login` to start the device-flow login.'
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

    // Visual preview pipeline — soft check, doesn't block any other feature.
    let previewOk = false;
    let previewDetail = '';
    let previewBin = '';
    for (const bin of ['soffice', 'libreoffice']) {
      try {
        await exec('which', [bin]);
        previewBin = bin;
        previewOk = true;
        break;
      } catch {
        // continue
      }
    }
    if (previewOk) {
      let hasPdftoppm = false;
      try {
        await exec('which', ['pdftoppm']);
        hasPdftoppm = true;
      } catch {
        hasPdftoppm = false;
      }
      previewDetail = `${previewBin} found${hasPdftoppm ? ' + pdftoppm' : ' (pdftoppm missing — needed for per-slide PNGs)'}`;
      previewOk = hasPdftoppm;
    } else {
      previewDetail = 'libreoffice not on $PATH';
    }
    checks.push({
      name: 'Visual critique pipeline',
      ok: previewOk,
      detail: previewDetail,
      soft: true,
      hint: previewOk
        ? undefined
        : 'The visual critique loop needs LibreOffice + poppler-utils. On Ubuntu/WSL: sudo apt install libreoffice poppler-utils. DeckPilot still works without it — just run with --critique-passes 0.',
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
