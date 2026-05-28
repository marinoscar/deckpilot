/**
 * Standalone .pptx → PNGs pipeline. Used by:
 *   - The visual critique loop (renderSlideToPng builds a deck first, then
 *     calls into this to rasterise).
 *   - Vision-driven template extraction (renders a user-supplied .pptx
 *     directly, no deck construction).
 *
 * Pipeline: soffice --convert-to pdf → pdftoppm -png. Both are part of the
 * standard LibreOffice + poppler-utils install on Linux/WSL/macOS.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import which from 'which';

const exec = promisify(execFile);

/**
 * Standard install locations to probe when the binary isn't on PATH. The
 * LibreOffice installer on Windows does NOT add `soffice.exe` to PATH by
 * default; macOS Homebrew puts it under /opt/homebrew on Apple Silicon.
 */
const SOFFICE_FALLBACKS = [
  // Windows
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  // macOS — both the .app bundle and brew-installed paths
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
];

const PDFTOPPM_FALLBACKS = [
  // Windows — common locations after `scoop install poppler` / manual zip extract
  'C:\\ProgramData\\chocolatey\\bin\\pdftoppm.exe',
  // macOS / Homebrew
  '/opt/homebrew/bin/pdftoppm',
  '/usr/local/bin/pdftoppm',
];

export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewUnavailableError';
  }
}

let cachedBinary: string | null | undefined;

/**
 * Resolve the absolute path of the LibreOffice binary if it's available
 * anywhere — PATH first, then a small set of standard install locations
 * for Windows / macOS where the installer doesn't always touch PATH.
 *
 * Cross-platform via the `which` npm package (handles `.exe` and PATHEXT).
 */
export async function findSofficeBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const candidate of ['soffice', 'libreoffice']) {
    try {
      const resolved = await which(candidate);
      cachedBinary = resolved;
      return resolved;
    } catch {
      // continue
    }
  }
  for (const fallback of SOFFICE_FALLBACKS) {
    if (existsSync(fallback)) {
      cachedBinary = fallback;
      return fallback;
    }
  }
  cachedBinary = null;
  return null;
}

/** Reset the cached lookup. Test-only escape hatch. */
export function _resetSofficeProbe(): void {
  cachedBinary = undefined;
}

export async function isPreviewAvailable(): Promise<boolean> {
  return (await findSofficeBinary()) !== null;
}

export type PptxToPngsOptions = {
  /** DPI passed to pdftoppm. 150 = preview quality, 100 = lighter for vision. */
  dpi?: number;
  /** Per-step timeout in ms. Defaults to 60s. */
  timeoutMs?: number;
};

/**
 * Rasterise an existing .pptx into one PNG per slide.
 *
 * Returns absolute paths to `<outDir>/slide-001.png`, `slide-002.png`, …
 * in slide order. `outDir` is created if it doesn't exist.
 */
export async function pptxToPngs(
  pptxPath: string,
  outDir: string,
  opts: PptxToPngsOptions = {},
): Promise<string[]> {
  const soffice = await findSofficeBinary();
  if (!soffice) {
    throw new PreviewUnavailableError(
      'LibreOffice is not installed. On Ubuntu/WSL: sudo apt install libreoffice poppler-utils. On macOS: brew install --cask libreoffice && brew install poppler.',
    );
  }
  if (!existsSync(pptxPath)) {
    throw new Error(`No such file: ${pptxPath}`);
  }

  await mkdir(outDir, { recursive: true });

  await rasteriseViaPdf(soffice, pptxPath, outDir, opts);

  // Collect the produced PNGs in numeric order.
  const entries = await readdir(outDir);
  const pngs = entries
    .filter((f) => /^slide-\d{3}\.png$/.test(f))
    .sort()
    .map((f) => join(outDir, f));
  if (pngs.length === 0) {
    throw new Error(`No slide PNGs produced in ${outDir}. Check LibreOffice + pdftoppm install.`);
  }
  return pngs;
}

async function rasteriseViaPdf(
  soffice: string,
  pptxPath: string,
  outDir: string,
  opts: PptxToPngsOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  try {
    await exec(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nofirststartwizard',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        pptxPath,
      ],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50 },
    );
  } catch (e) {
    throw new Error(`LibreOffice PDF export failed: ${(e as Error).message}`);
  }

  // soffice names the PDF after the input basename, dropping any path.
  const base = pptxPath.split('/').pop() ?? pptxPath;
  const pdfBase = base.replace(/\.pptx$/i, '.pdf');
  const pdfPath = join(outDir, pdfBase);
  if (!existsSync(pdfPath)) {
    throw new Error(`Expected ${pdfPath} after LibreOffice PDF conversion`);
  }

  let pdftoppmBin: string;
  try {
    pdftoppmBin = await which('pdftoppm');
  } catch {
    const fallback = PDFTOPPM_FALLBACKS.find((p) => existsSync(p));
    if (!fallback) {
      throw new PreviewUnavailableError(
        '`pdftoppm` (poppler-utils) is required for the preview pipeline. On Ubuntu/WSL: sudo apt install poppler-utils. On macOS: brew install poppler. On Windows: scoop install poppler (or choco install poppler).',
      );
    }
    pdftoppmBin = fallback;
  }

  const dpi = String(opts.dpi ?? 150);
  const slidePrefix = join(outDir, 'slide');
  try {
    await exec(pdftoppmBin, ['-png', '-r', dpi, pdfPath, slidePrefix], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 50,
    });
  } catch (e) {
    throw new Error(`pdftoppm failed: ${(e as Error).message}`);
  }

  // pdftoppm names files slide-1.png, slide-2.png … with no zero-pad. Rename
  // to slide-001.png so sorting is lexical and stable across deck sizes.
  const entries = await readdir(outDir);
  for (const f of entries) {
    const m = f.match(/^slide-(\d+)\.png$/);
    if (!m) continue;
    const n = Number(m[1]);
    const padded = `slide-${String(n).padStart(3, '0')}.png`;
    if (padded === f) continue;
    const oldPath = join(outDir, f);
    const newPath = join(outDir, padded);
    if (!existsSync(newPath)) {
      const data = await readFile(oldPath);
      await writeFile(newPath, data);
      await rm(oldPath);
    }
  }
}

export async function readPng(path: string): Promise<Buffer> {
  return readFile(path);
}

/** Wipe a cache directory entirely. */
export async function clearDir(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}
