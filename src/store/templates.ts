/**
 * Template store — CRUD over `~/.deckpilot/templates/<name>/`.
 *
 * Each template is a directory:
 *   <name>/
 *     template.json      # TemplateSpec (validated by Zod on read/write)
 *     assets/...         # optional logo/wordmark/background images
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  formatZodError,
  TemplateSpecSchema,
  type ResolvedTemplate,
  type TemplateSpec,
} from '../template/spec.js';
import { templateDir, templatesRoot } from './paths.js';

export class TemplateNotFoundError extends Error {
  constructor(name: string) {
    super(`Template "${name}" not found at ${templateDir(name)}.`);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateExistsError extends Error {
  constructor(name: string) {
    super(`Template "${name}" already exists at ${templateDir(name)}. Pass overwrite=true to replace it.`);
    this.name = 'TemplateExistsError';
  }
}

export type TemplateListEntry = {
  name: string;
  /** Resolved spec for one-line summaries. Logos NOT resolved. */
  spec: TemplateSpec;
  rootDir: string;
};

/** List every template under `~/.deckpilot/templates/`. */
export async function listTemplates(): Promise<TemplateListEntry[]> {
  const root = templatesRoot();
  if (!existsSync(root)) return [];
  const dirents = await readdir(root, { withFileTypes: true });
  const entries: TemplateListEntry[] = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    try {
      const spec = await readSpec(d.name);
      entries.push({ name: d.name, spec, rootDir: templateDir(d.name) });
    } catch {
      // Skip directories without a valid template.json so a half-broken
      // template doesn't tank the picker.
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** Load a single template by name, resolving asset paths to absolute. */
export async function loadTemplate(name: string): Promise<ResolvedTemplate> {
  const dir = templateDir(name);
  if (!existsSync(dir)) throw new TemplateNotFoundError(name);
  const spec = await readSpec(name);
  return {
    ...spec,
    rootDir: dir,
    assets: spec.assets ? resolveAssets(spec.assets, dir) : undefined,
  };
}

/**
 * Write a TemplateSpec to disk. Creates the template directory + an empty
 * `assets/` subdir if they don't already exist. Validates before writing.
 *
 * Set `overwrite: true` to replace an existing template's `template.json`
 * (asset files in `assets/` are left alone — the caller manages those).
 */
export async function saveTemplate(
  spec: TemplateSpec,
  opts: { overwrite?: boolean } = {},
): Promise<{ rootDir: string }> {
  const parsed = TemplateSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new Error(`TemplateSpec failed validation:\n${formatZodError(parsed.error)}`);
  }
  const dir = templateDir(parsed.data.name);
  const exists = existsSync(join(dir, 'template.json'));
  if (exists && !opts.overwrite) throw new TemplateExistsError(parsed.data.name);

  await mkdir(join(dir, 'assets'), { recursive: true });
  await atomicWriteJson(join(dir, 'template.json'), parsed.data);
  return { rootDir: dir };
}

/** Delete a template directory entirely. */
export async function deleteTemplate(name: string): Promise<void> {
  const dir = templateDir(name);
  if (!existsSync(dir)) throw new TemplateNotFoundError(name);
  await rm(dir, { recursive: true, force: true });
}

/** Read + validate a template.json into a TemplateSpec. */
async function readSpec(name: string): Promise<TemplateSpec> {
  const file = join(templateDir(name), 'template.json');
  if (!existsSync(file)) throw new TemplateNotFoundError(name);
  const raw = await readFile(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Template "${name}" has invalid JSON: ${(e as Error).message}`);
  }
  const result = TemplateSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Template "${name}" failed validation:\n${formatZodError(result.error)}`);
  }
  if (result.data.name !== name) {
    throw new Error(
      `Template "${name}" has mismatched internal name "${result.data.name}". Rename the directory or fix the spec.`,
    );
  }
  return result.data;
}

function resolveAssets(
  assets: NonNullable<TemplateSpec['assets']>,
  rootDir: string,
): ResolvedTemplate['assets'] {
  const out: NonNullable<ResolvedTemplate['assets']> = {};
  for (const key of ['logo', 'wordmark', 'background'] as const) {
    const rel = assets[key];
    if (!rel) continue;
    const abs = resolve(rootDir, rel);
    if (existsSync(abs)) out[key] = abs;
    // If the file is missing we drop the field silently — the LLM should
    // fall back to text rather than emit a bad addImage call.
  }
  return out;
}

/** Write JSON atomically: tmp file → rename. */
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, path);
}

/** Existence check that doesn't throw — used by CLI commands. */
export async function templateExists(name: string): Promise<boolean> {
  try {
    await stat(join(templateDir(name), 'template.json'));
    return true;
  } catch {
    return false;
  }
}
