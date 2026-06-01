import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

export type FileEntry = {
  /** Path relative to cwd (or absolute if outside cwd). */
  path: string;
  /** Display label — usually just the basename. */
  name: string;
  /** `.pptx` (template / saved deck), `.plan.json` (saved plan), `.pdf`, image, document, etc. */
  kind: 'pptx' | 'plan.json' | 'json' | 'image' | 'document' | 'other';
  /** Last-modified epoch ms, for sorting. */
  mtime: number;
  /** Size in bytes. */
  size: number;
};

const INTERESTING = /\.(pptx|plan\.json|json|pdf)$/i;
/** Image formats the LLM can understand (used by the `/image` picker). */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
/** Document formats whose text can be extracted (used by the `/doc` picker). */
export const DOCUMENT_EXT = /\.(txt|md|markdown|pptx|docx)$/i;

/** Which file set the workspace scan surfaces. */
export type ScanKinds = 'default' | 'images' | 'documents';

/** Max reference images stageable per turn, and max bytes per image. */
export const MAX_ATTACHED_IMAGES = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Max reference documents stageable per turn. */
export const MAX_ATTACHED_DOCUMENTS = 8;

/**
 * Map an image filename to the MIME type DeckPilot sends to the model, or
 * null when the extension isn't a supported image. Single source of truth for
 * both the `/image` picker filter and the base64 attachment encoder.
 */
export function extToMime(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

/**
 * Toggle `path` in a staged list: add when absent (capped at `max`), remove
 * when present. Pure + deduped so the multi-select picker logic is
 * unit-testable without ink. Shared by the image and document pickers.
 */
export function toggleImage(list: string[], path: string, max = MAX_ATTACHED_IMAGES): string[] {
  if (list.includes(path)) return list.filter((p) => p !== path);
  if (list.length >= max) return list;
  return [...list, path];
}

/**
 * Add `paths` to `list` (deduped, order-preserving, capped at `max`). Add-only
 * — used when committing a picker selection into the staged set, unlike
 * `toggleImage`.
 */
export function mergeImages(list: string[], paths: string[], max = MAX_ATTACHED_IMAGES): string[] {
  const out = [...list];
  for (const p of paths) {
    if (out.length >= max) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Document-picker aliases for the staged-list helpers (capped at the doc max). */
export const toggleDocument = (list: string[], path: string): string[] =>
  toggleImage(list, path, MAX_ATTACHED_DOCUMENTS);
export const mergeDocuments = (list: string[], paths: string[]): string[] =>
  mergeImages(list, paths, MAX_ATTACHED_DOCUMENTS);

/**
 * Scan a directory (default: cwd) for files the `@` picker should surface. We
 * intentionally only show files the user can plausibly want for /template,
 * /load, or as conversational references. Hidden files and `node_modules`
 * are skipped.
 */
export async function scanWorkspaceFiles(
  dir: string = process.cwd(),
  opts: { recursive?: boolean; max?: number; kinds?: ScanKinds } = {},
): Promise<FileEntry[]> {
  const max = opts.max ?? 200;
  const out: FileEntry[] = [];
  const match =
    opts.kinds === 'images' ? IMAGE_EXT : opts.kinds === 'documents' ? DOCUMENT_EXT : INTERESTING;
  await walk(dir, dir, out, max, opts.recursive ?? false, match);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, max);
}

async function walk(
  root: string,
  cur: string,
  out: FileEntry[],
  max: number,
  recursive: boolean,
  match: RegExp,
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
      if (recursive) await walk(root, full, out, max, recursive, match);
      continue;
    }
    if (!match.test(e.name)) continue;
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
  if (IMAGE_EXT.test(name)) return 'image';
  if (DOCUMENT_EXT.test(name)) return 'document';
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
