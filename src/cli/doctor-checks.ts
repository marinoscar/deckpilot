import { constants, accessSync } from 'node:fs';
import { checkCopilotSdk, checkGitHubToken } from '../copilot/readiness.js';
import { isPreviewAvailable } from '../render/pptx-to-pngs.js';

export type Check = {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
  /** Soft checks warn but don't make the overall result fail. */
  soft?: boolean;
};

/**
 * Run the preflight diagnostics shared by the `doctor` command and the TUI
 * Doctor screen: Node version, GitHub auth/entitlement, cwd write access,
 * Copilot SDK reachability, and the visual critique pipeline.
 */
export async function runDoctorChecks(token?: string): Promise<Check[]> {
  const checks: Check[] = [];

  const major = Number.parseInt(process.versions.node.split('.')[0]!, 10);
  checks.push({
    name: 'Node ≥ 22',
    ok: major >= 22,
    detail: `node ${process.versions.node}`,
    hint: major >= 22 ? undefined : 'Upgrade Node (try `nvm install 22`).',
  });

  checks.push(checkGitHubToken(token));

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

  checks.push(await checkCopilotSdk(token));

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

  return checks;
}

/** True when every hard (non-soft) check passed. Soft checks only warn. */
export function allHardChecksOk(checks: Check[]): boolean {
  return checks.every((c) => c.ok || c.soft);
}
