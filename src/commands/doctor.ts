import { constants, accessSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import which from 'which';
import { BaseCommand } from '../cli/base-command.js';
import { describeTokenSource, resolveGitHubToken } from '../copilot/auth.js';
import { createClient } from '../copilot/client.js';
import { findSofficeBinary } from '../render/pptx-to-pngs.js';

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

    // Visual preview pipeline — soft check, doesn't block any other feature.
    // findSofficeBinary checks PATH + a small list of standard install locations
    // on Windows / macOS so the LibreOffice installer's "not on PATH by default"
    // behaviour doesn't make doctor cry wolf.
    const sofficePath = await findSofficeBinary();
    let previewOk = false;
    let previewDetail = '';
    if (sofficePath) {
      let pdftoppmPath: string | null = null;
      try {
        pdftoppmPath = await which('pdftoppm');
      } catch {
        // probe standard locations as a fallback
        const fallbacks = [
          'C:\\ProgramData\\chocolatey\\bin\\pdftoppm.exe',
          '/opt/homebrew/bin/pdftoppm',
          '/usr/local/bin/pdftoppm',
        ];
        pdftoppmPath = fallbacks.find((p) => existsSync(p)) ?? null;
      }
      previewDetail = pdftoppmPath
        ? `${sofficePath} + ${pdftoppmPath}`
        : `${sofficePath} (pdftoppm missing — needed for per-slide PNGs)`;
      previewOk = pdftoppmPath !== null;
    } else {
      previewDetail = 'libreoffice not found on PATH or in standard install locations';
    }
    checks.push({
      name: 'Visual critique pipeline',
      ok: previewOk,
      detail: previewDetail,
      soft: true,
      hint: previewOk ? undefined : platformInstallHint(),
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

/** Platform-appropriate install hint for the LibreOffice + poppler pair. */
function platformInstallHint(): string {
  const base =
    'The visual critique loop needs LibreOffice + poppler. DeckPilot still works without it — just run with --critique-passes 0.';
  switch (process.platform) {
    case 'darwin':
      return `${base} On macOS: brew install --cask libreoffice && brew install poppler.`;
    case 'win32':
      return `${base} On Windows: winget install TheDocumentFoundation.LibreOffice (and add C:\\Program Files\\LibreOffice\\program to PATH), then \`scoop install poppler\` or \`choco install poppler\`.`;
    default:
      return `${base} On Ubuntu/WSL: sudo apt install libreoffice poppler-utils. On Fedora: sudo dnf install libreoffice poppler-utils. On Arch: sudo pacman -S libreoffice-fresh poppler.`;
  }
}
