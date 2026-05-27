/**
 * Project-level configuration: a DECKPILOT.md file in the working directory
 * (or any ancestor) that acts as a persistent style guide / standing
 * instructions block. The file is read once at session start and prepended
 * to the system prompt as a typed "user style guide" preamble — so every
 * deck the user generates from that directory honours the same standing
 * rules without them having to re-state them every chat.
 *
 * Format: plain markdown. No frontmatter required. The whole file is
 * appended as-is.
 *
 * Resolution: walk from cwd upward to /. First DECKPILOT.md found wins.
 * (Mirrors how CLAUDE.md and other tooling discover project config.)
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type ProjectStyleGuide = {
  /** Absolute path the guide was loaded from. */
  path: string;
  /** Raw markdown content. */
  content: string;
  /** Approximate character count (handy for the LLM token budget). */
  bytes: number;
};

const FILENAME = 'DECKPILOT.md';
const MAX_BYTES = 12_000; // ~3-4k tokens of style guidance — generous but bounded

export function findStyleGuidePath(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  // Walk up until / — bail when dirname returns the same dir.
  for (let i = 0; i < 50; i++) {
    const candidate = join(dir, FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export async function loadStyleGuide(
  startDir: string = process.cwd(),
): Promise<ProjectStyleGuide | null> {
  const path = findStyleGuidePath(startDir);
  if (!path) return null;
  const raw = await readFile(path, 'utf8');
  // Cap at MAX_BYTES so a runaway DECKPILOT.md can't blow the system prompt
  // token budget. Truncate with a clear marker so the LLM knows it happened.
  const truncated =
    raw.length > MAX_BYTES
      ? raw.slice(0, MAX_BYTES) + `\n\n[…DECKPILOT.md truncated at ${MAX_BYTES} bytes…]`
      : raw;
  return {
    path,
    content: truncated,
    bytes: truncated.length,
  };
}

/** Wrap a style guide in a clearly-labelled system-prompt block. */
export function renderStyleGuideBlock(guide: ProjectStyleGuide): string {
  return [
    '## Project style guide (loaded from DECKPILOT.md)',
    '',
    `The user maintains standing style/instruction rules in \`${guide.path}\`. Treat the rules below as binding for this deck unless the user explicitly overrides them in chat. Style choices stated here trump anything you'd otherwise default to.`,
    '',
    '--- BEGIN DECKPILOT.md ---',
    guide.content.trim(),
    '--- END DECKPILOT.md ---',
  ].join('\n');
}
