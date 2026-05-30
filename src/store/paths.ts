/**
 * One source of truth for every DeckPilot on-disk location under the user's
 * home directory. Tests override the root via `DECKPILOT_HOME=<tmpdir>`.
 *
 * Layout (when DECKPILOT_HOME is unset):
 *   ~/.deckpilot/
 *     config.json
 *     projects/<slug>/{project.json, brief.json, slides/, transcript.jsonl, ...}
 *     templates/<name>/{template.json, assets/}
 *     skills/<name>/{SKILL.md, assets/}
 *
 * Built-in (read-only) skills ship inside the package at `<pkg>/skills/<name>/`,
 * resolved by `builtinSkillsRoot()` relative to this compiled module.
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELATIVE_ROOT = '.deckpilot';

/** Resolve the DeckPilot home root, honouring DECKPILOT_HOME for tests. */
export function homeRoot(): string {
  const env = process.env.DECKPILOT_HOME?.trim();
  if (env) return env;
  return join(homedir(), RELATIVE_ROOT);
}

export function projectsRoot(): string {
  return join(homeRoot(), 'projects');
}

export function templatesRoot(): string {
  return join(homeRoot(), 'templates');
}

/** User-authored skills under the DeckPilot home root. */
export function skillsRoot(): string {
  return join(homeRoot(), 'skills');
}

/**
 * Read-only skills bundled with the package. The compiled module lives at
 * `<pkg>/dist/store/paths.js`; the shipped skills sit at `<pkg>/skills/`, two
 * directories up. In dev (tsx from `src/store/`) the same `../../skills`
 * resolves to the repo-root `skills/` dir, which is where the source lives too.
 */
export function builtinSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'skills');
}

export function configFile(): string {
  return join(homeRoot(), 'config.json');
}

export function projectDir(slug: string): string {
  return join(projectsRoot(), slug);
}

export function templateDir(name: string): string {
  return join(templatesRoot(), name);
}

export function skillDir(name: string): string {
  return join(skillsRoot(), name);
}

export function builtinSkillDir(name: string): string {
  return join(builtinSkillsRoot(), name);
}

/**
 * Lower-case kebab from arbitrary user input. Allows letters, digits, and
 * single hyphens; collapses runs and strips leading/trailing dashes. Returns
 * an empty string for inputs that yield no usable characters — caller decides
 * what to do then (typically reject + ask for a better name).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
