import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

export type FileEntry = {
  /** Path relative to cwd (or absolute if outside cwd). */
  path: string;
  /** Display label — usually just the basename. */
  name: string;
  /** `.pptx` (template / saved deck), `.plan.json` (saved plan), `.pdf` / etc. */
  kind: 'pptx' | 'plan.json' | 'json' | 'other';
  /** Last-modified epoch ms, for sorting. */
  mtime: number;
  /** Size in bytes. */
  size: number;
};

const INTERESTING = /\.(pptx|plan\.json|json|pdf)$/i;

/**
 * Scan a directory (default: cwd) for files the `@` picker should surface. We
 * intentionally only show files the user can plausibly want for /template,
 * /load, or as conversational references. Hidden files and `node_modules`
 * are skipped.
 */
export async function scanWorkspaceFiles(
  dir: string = process.cwd(),
  opts: { recursive?: boolean; max?: number } = {},
): Promise<FileEntry[]> {
  const max = opts.max ?? 200;
  const out: FileEntry[] = [];
  await walk(dir, dir, out, max, opts.recursive ?? false);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, max);
}

async function walk(
  root: string,
  cur: string,
  out: FileEntry[],
  max: number,
  recursive: boolean,
): Promise<void> {
  if (out.length >= max) return;
  let entries;
  try {
    entries = await readdir(cur, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= max) return;
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
    const full = join(cur, e.name);
    if (e.isDirectory()) {
      if (recursive) await walk(root, full, out, max, recursive);
      continue;
    }
    if (!INTERESTING.test(e.name)) continue;
    try {
      const st = await stat(full);
      // path.sep — `/` on Linux/macOS, `\` on Windows. Hard-coding `/` here
      // would mean Windows paths never match the prefix and we'd return the
      // absolute path instead of the cwd-relative one.
      out.push({
        path: full.startsWith(root + sep) ? full.slice(root.length + sep.length) : full,
        name: e.name,
        kind: classify(e.name),
        mtime: st.mtimeMs,
        size: st.size,
      });
    } catch {
      // skip unreadable files
    }
  }
}

function classify(name: string): FileEntry['kind'] {
  if (/\.pptx$/i.test(name)) return 'pptx';
  if (/\.plan\.json$/i.test(name)) return 'plan.json';
  if (/\.json$/i.test(name)) return 'json';
  return 'other';
}

/**
 * Fuzzy-ish filter: substring match across the path (case-insensitive),
 * stable original ordering after filtering.
 */
export function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}
