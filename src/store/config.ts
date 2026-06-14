/**
 * User-level configuration store at `~/.deckpilot/config.json`
 * (Windows: `%USERPROFILE%\.deckpilot\config.json`).
 *
 * Settings written here are used as defaults at startup by `deckpilot
 * start`, `deckpilot chat`, and `deckpilot resume`. CLI flags still win.
 * The TUI "Settings" screen reads and writes the same file, so the CLI
 * and TUI are two views of one persistent state.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { configFile } from './paths.js';

export const ToneEnum = z.enum([
  'editorial',
  'minimal',
  'bold',
  'soft',
  'tech',
  'playful',
  'corporate',
]);

const DefaultsSchema = z
  .object({
    /** Hard cap on critique/preview passes per slide. 0 disables visual critique. */
    critiquePassesPerSlide: z.number().int().min(0).max(5).optional(),
    /** Default Copilot model id (overridden by --model). */
    model: z.string().min(1).max(128).optional(),
    /** Default named template slug (overridden by --template). */
    template: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'must be lower-kebab')
      .optional(),
    /** Default skill slug (overridden by --skill). */
    skill: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'must be lower-kebab')
      .optional(),
  })
  .strict();

/**
 * One-time onboarding state. Not user-settable via `config set` — written
 * programmatically (e.g. once the TUI first-run Copilot readiness check passes).
 */
const OnboardingSchema = z
  .object({
    /** Set true after the first-run Copilot readiness gate has passed once. */
    copilotReady: z.boolean().default(false),
  })
  .strict();

export const ConfigSchema = z
  .object({
    schemaVersion: z.literal('1.0').default('1.0'),
    defaults: DefaultsSchema.default({}),
    onboarding: OnboardingSchema.default({ copilotReady: false }),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigDefaults = z.infer<typeof DefaultsSchema>;

/** Map user-friendly key aliases → canonical dotted path. */
const ALIASES: Record<string, string> = {
  'critique-passes': 'defaults.critiquePassesPerSlide',
  critiquepasses: 'defaults.critiquePassesPerSlide',
  model: 'defaults.model',
  template: 'defaults.template',
  skill: 'defaults.skill',
};

/** Canonicalize a config key from user input. */
export function canonicalKey(key: string): string {
  const k = key.trim();
  if (k in ALIASES) return ALIASES[k];
  const lower = k.toLowerCase();
  if (lower in ALIASES) return ALIASES[lower];
  return k;
}

/** Every settable key, in display order. */
export const SETTABLE_KEYS = [
  'defaults.critiquePassesPerSlide',
  'defaults.model',
  'defaults.template',
  'defaults.skill',
] as const;

export class InvalidConfigKeyError extends Error {
  constructor(key: string) {
    super(`Unknown config key "${key}". Settable keys: ${SETTABLE_KEYS.join(', ')}.`);
    this.name = 'InvalidConfigKeyError';
  }
}

export class InvalidConfigValueError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid value for "${key}": ${reason}`);
    this.name = 'InvalidConfigValueError';
  }
}

/** Returns a fresh default config (no file written). */
export function emptyConfig(): Config {
  return ConfigSchema.parse({});
}

/** Where on disk this config lives. Re-exported for callers + tests. */
export function configPath(): string {
  return configFile();
}

/**
 * Load `~/.deckpilot/config.json`, returning `emptyConfig()` if absent. A
 * corrupt or invalid file throws so the user notices, rather than silently
 * losing their settings.
 */
export async function loadConfig(): Promise<Config> {
  const path = configFile();
  if (!existsSync(path)) return emptyConfig();
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json at ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return ConfigSchema.parse(parsed);
}

/** Write the config atomically (tmp → rename). Validates first. */
export async function saveConfig(cfg: Config): Promise<void> {
  const validated = ConfigSchema.parse(cfg);
  const path = configFile();
  const tmp = `${path}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`);
  await rename(tmp, path);
}

/** Read a value at a canonical dotted path. Returns undefined if unset. */
export function getConfigValue(cfg: Config, key: string): unknown {
  const canonical = canonicalKey(key);
  if (!SETTABLE_KEYS.includes(canonical as (typeof SETTABLE_KEYS)[number])) {
    throw new InvalidConfigKeyError(key);
  }
  const [head, tail] = canonical.split('.');
  if (head !== 'defaults') return undefined;
  return (cfg.defaults as Record<string, unknown>)[tail];
}

/**
 * Set a value at a canonical dotted path, returning a NEW config object.
 * Strings are coerced for numeric keys. Validation runs through the full
 * ConfigSchema so the caller gets a meaningful Zod error on bad input.
 */
export function setConfigValue(cfg: Config, key: string, value: string): Config {
  const canonical = canonicalKey(key);
  if (!SETTABLE_KEYS.includes(canonical as (typeof SETTABLE_KEYS)[number])) {
    throw new InvalidConfigKeyError(key);
  }
  const next: Config = {
    schemaVersion: cfg.schemaVersion,
    defaults: { ...cfg.defaults },
    onboarding: { ...cfg.onboarding },
  };
  const [, tail] = canonical.split('.');
  let coerced: unknown = value;
  if (canonical === 'defaults.critiquePassesPerSlide') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new InvalidConfigValueError(canonical, `expected a number, got "${value}"`);
    }
    coerced = n;
  }
  (next.defaults as Record<string, unknown>)[tail] = coerced;
  try {
    return ConfigSchema.parse(next);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new InvalidConfigValueError(canonical, e.issues[0]?.message ?? 'invalid');
    }
    throw e;
  }
}

/** Unset (delete) a key. Returns a NEW config. */
export function unsetConfigValue(cfg: Config, key: string): Config {
  const canonical = canonicalKey(key);
  if (!SETTABLE_KEYS.includes(canonical as (typeof SETTABLE_KEYS)[number])) {
    throw new InvalidConfigKeyError(key);
  }
  const next: Config = {
    schemaVersion: cfg.schemaVersion,
    defaults: { ...cfg.defaults },
    onboarding: { ...cfg.onboarding },
  };
  const [, tail] = canonical.split('.');
  delete (next.defaults as Record<string, unknown>)[tail];
  return ConfigSchema.parse(next);
}

/**
 * Has the first-run Copilot readiness gate already passed once? Reads the
 * persisted onboarding flag, defaulting to `false` (show the gate) on any
 * read error so a corrupt/absent config never silently skips the check.
 */
export async function isCopilotOnboarded(): Promise<boolean> {
  try {
    const cfg = await loadConfig();
    return cfg.onboarding.copilotReady === true;
  } catch {
    return false;
  }
}

/** Record that Copilot has been verified ready, so future launches skip the gate. */
export async function markCopilotOnboarded(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.onboarding.copilotReady) return;
  await saveConfig({ ...cfg, onboarding: { ...cfg.onboarding, copilotReady: true } });
}
