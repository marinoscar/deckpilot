/**
 * Skill store — CRUD over user skills at `~/.deckpilot/skills/<name>/` plus
 * read-only built-in skills bundled with the package.
 *
 * Each skill is a directory:
 *   <name>/
 *     SKILL.md           # frontmatter + "## <stage>" sections (validated on read/write)
 *     assets/...         # reserved for future use
 *
 * Built-in and user skills are merged on listing; a user skill with the same
 * name shadows the built-in (so users can fork-to-customize). Built-ins are
 * read-only — saveSkill always writes to the user dir, and deleteSkill refuses
 * built-ins.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ResolvedSkill, type SkillSpec, parseSkillMarkdown } from '../skill/spec.js';
import { builtinSkillDir, builtinSkillsRoot, skillDir, skillsRoot } from './paths.js';

export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`Skill "${name}" not found at ${skillDir(name)} or among the built-ins.`);
    this.name = 'SkillNotFoundError';
  }
}

export class SkillExistsError extends Error {
  constructor(name: string) {
    super(
      `Skill "${name}" already exists at ${skillDir(name)}. Pass overwrite=true to replace it.`,
    );
    this.name = 'SkillExistsError';
  }
}

export class BuiltinSkillError extends Error {
  constructor(name: string) {
    super(
      `Skill "${name}" is a built-in and cannot be modified. Create a copy with a new name to customize it (deckpilot skill create <name>).`,
    );
    this.name = 'BuiltinSkillError';
  }
}

export type SkillListEntry = {
  name: string;
  spec: SkillSpec;
  rootDir: string;
  builtin: boolean;
};

/** List built-in + user skills. User skills shadow built-ins of the same name. */
export async function listSkills(): Promise<SkillListEntry[]> {
  const byName = new Map<string, SkillListEntry>();

  // Built-ins first, so user skills can override them.
  for (const name of await dirNames(builtinSkillsRoot())) {
    const spec = await tryReadSpec(builtinSkillDir(name), name);
    if (spec) byName.set(name, { name, spec, rootDir: builtinSkillDir(name), builtin: true });
  }
  for (const name of await dirNames(skillsRoot())) {
    const spec = await tryReadSpec(skillDir(name), name);
    if (spec) byName.set(name, { name, spec, rootDir: skillDir(name), builtin: false });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Load a single skill by name — user dir first, then built-ins. */
export async function loadSkill(name: string): Promise<ResolvedSkill> {
  const userDir = skillDir(name);
  if (existsSync(join(userDir, 'SKILL.md'))) {
    const spec = await readSpec(userDir, name);
    return { ...spec, rootDir: userDir, builtin: false };
  }
  const builtinDir = builtinSkillDir(name);
  if (existsSync(join(builtinDir, 'SKILL.md'))) {
    const spec = await readSpec(builtinDir, name);
    return { ...spec, rootDir: builtinDir, builtin: true };
  }
  throw new SkillNotFoundError(name);
}

/**
 * Write a SKILL.md to the user skills dir. Validates the markdown before
 * writing. Built-ins are never written here (they live inside the package).
 */
export async function saveSkill(
  name: string,
  markdown: string,
  opts: { overwrite?: boolean } = {},
): Promise<{ rootDir: string }> {
  // Validate (and confirm the internal name matches) before touching disk.
  parseSkillMarkdown(name, markdown);

  const dir = skillDir(name);
  const file = join(dir, 'SKILL.md');
  if (existsSync(file) && !opts.overwrite) throw new SkillExistsError(name);

  await mkdir(join(dir, 'assets'), { recursive: true });
  await atomicWrite(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
  return { rootDir: dir };
}

/** Delete a user skill directory. Refuses built-ins. */
export async function deleteSkill(name: string): Promise<void> {
  const dir = skillDir(name);
  if (!existsSync(dir)) {
    // It might be a built-in (which we can't delete) or just absent.
    if (existsSync(builtinSkillDir(name))) throw new BuiltinSkillError(name);
    throw new SkillNotFoundError(name);
  }
  await rm(dir, { recursive: true, force: true });
}

/** Existence check (built-in OR user) that doesn't throw. */
export async function skillExists(name: string): Promise<boolean> {
  for (const dir of [skillDir(name), builtinSkillDir(name)]) {
    try {
      await stat(join(dir, 'SKILL.md'));
      return true;
    } catch {
      // keep checking
    }
  }
  return false;
}

/** True if `name` resolves to a built-in and there is no user override. */
export async function isBuiltinSkill(name: string): Promise<boolean> {
  if (existsSync(join(skillDir(name), 'SKILL.md'))) return false;
  return existsSync(join(builtinSkillDir(name), 'SKILL.md'));
}

async function dirNames(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const dirents = await readdir(root, { withFileTypes: true });
  return dirents.filter((d) => d.isDirectory()).map((d) => d.name);
}

async function tryReadSpec(dir: string, name: string): Promise<SkillSpec | null> {
  try {
    return await readSpec(dir, name);
  } catch {
    // Skip directories without a valid SKILL.md so a half-broken skill doesn't
    // tank the picker.
    return null;
  }
}

async function readSpec(dir: string, name: string): Promise<SkillSpec> {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) throw new SkillNotFoundError(name);
  const raw = await readFile(file, 'utf8');
  return parseSkillMarkdown(name, raw);
}

/** Write a file atomically: tmp file → rename. */
async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(tmp, data);
  await rename(tmp, path);
}
