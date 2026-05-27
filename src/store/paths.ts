/**
 * One source of truth for every DeckPilot on-disk location under the user's
 * home directory. Tests override the root via `DECKPILOT_HOME=<tmpdir>`.
 *
 * Layout (when DECKPILOT_HOME is unset):
 *   ~/.deckpilot/
 *     config.json
 *     projects/<slug>/{project.json, brief.json, slides/, transcript.jsonl, ...}
 *     templates/<name>/{template.json, assets/}
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function configFile(): string {
  return join(homeRoot(), 'config.json');
}

export function projectDir(slug: string): string {
  return join(projectsRoot(), slug);
}

export function templateDir(name: string): string {
  return join(templatesRoot(), name);
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
