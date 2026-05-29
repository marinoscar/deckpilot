/**
 * Tiny wrapper around jszip for packing / unpacking template + project
 * directories. Kept dependency-free of other DeckPilot modules so it can be
 * unit-tested on plain fixture trees.
 *
 * Cross-platform: uses POSIX-style entry names inside the zip (jszip's
 * default) so an archive packed on Linux unpacks correctly on Windows and
 * vice-versa. On unpack, we reconstruct paths with `node:path.join`.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import JSZip from 'jszip';

/**
 * Recursively pack every regular file under `srcDir` into a new zip file at
 * `outZip`. Returns the absolute path of the written zip.
 *
 * Symlinks are skipped (Windows doesn't have them universally; we don't need
 * them for templates/projects either).
 */
export async function packDirectory(srcDir: string, outZip: string): Promise<string> {
  if (!existsSync(srcDir)) {
    throw new Error(`Source directory not found: ${srcDir}`);
  }
  const zip = new JSZip();
  await walkInto(srcDir, srcDir, zip);
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await mkdir(dirname(outZip), { recursive: true });
  await writeFile(outZip, buf);
  return outZip;
}

async function walkInto(root: string, current: string, zip: JSZip): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkInto(root, abs, zip);
      continue;
    }
    if (!entry.isFile()) continue;
    // jszip wants POSIX-style relative paths inside the archive.
    const rel = relative(root, abs).split(sep).join('/');
    const bytes = await readFile(abs);
    zip.file(rel, bytes);
  }
}

/**
 * Extract every entry from `srcZip` into `destDir`, creating subdirectories
 * as needed. Rejects entries containing `..` or absolute paths — defends
 * against a hostile archive trying to escape `destDir` (a.k.a. "zip slip").
 */
export async function unpackZip(srcZip: string, destDir: string): Promise<void> {
  if (!existsSync(srcZip)) throw new Error(`Zip file not found: ${srcZip}`);
  const buf = await readFile(srcZip);
  const zip = await JSZip.loadAsync(buf);

  await mkdir(destDir, { recursive: true });

  const files = Object.entries(zip.files);
  for (const [name, entry] of files) {
    if (entry.dir) continue;
    if (containsTraversal(name)) {
      throw new Error(`Refusing to extract path "${name}" — contains "..".`);
    }
    const relParts = name.split('/');
    const outPath = join(destDir, ...relParts);
    await mkdir(dirname(outPath), { recursive: true });
    const data = await entry.async('nodebuffer');
    await writeFile(outPath, data);
  }
}

function containsTraversal(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  // Match Windows drive letters too.
  if (/^[A-Za-z]:[\\/]/.test(name)) return true;
  const parts = name.split(/[\\/]/);
  return parts.some((p) => p === '..');
}

/**
 * List the entries in a zip (paths + sizes), without extracting. Used by the
 * `template import` command to find `template.json` before unpacking.
 */
export async function listZipEntries(
  srcZip: string,
): Promise<{ name: string; size: number; dir: boolean }[]> {
  if (!existsSync(srcZip)) throw new Error(`Zip file not found: ${srcZip}`);
  const buf = await readFile(srcZip);
  const zip = await JSZip.loadAsync(buf);
  const out: { name: string; size: number; dir: boolean }[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    const data = entry.dir ? Buffer.from('') : await entry.async('nodebuffer');
    out.push({ name, size: data.length, dir: entry.dir });
  }
  return out;
}

/** Read one file's bytes from a zip without extracting the whole archive. */
export async function readZipEntry(srcZip: string, name: string): Promise<Buffer | null> {
  const buf = await readFile(srcZip);
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file(name);
  if (!entry) return null;
  return entry.async('nodebuffer');
}

/** Mark this module as used by stat helpers. */
export { stat };
