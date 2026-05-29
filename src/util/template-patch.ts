/**
 * Apply --set key=value patches to a TemplateSpec. Used by `deckpilot
 * template edit --set a=b --set c=d`. Validates the result through
 * TemplateSpecSchema; the caller chooses what to do with the error.
 */
import { type TemplateSpec, TemplateSpecSchema, formatZodError } from '../template/spec.js';

const TONE_VALUES = [
  'editorial',
  'minimal',
  'corporate',
  'energetic',
  'studious',
  'playful',
  'luxe',
] as const;

const TOP_LEVEL = new Set(['name', 'brand', 'description', 'voiceHints', 'copyRules', 'guidance']);

const THEME_KEYS = new Set([
  'accent',
  'accentAlt',
  'ink',
  'muted',
  'paper',
  'fontHeading',
  'fontBody',
  'tone',
  'aspect',
]);

const ASSET_KEYS = new Set(['logo', 'wordmark', 'background']);

const TEMPLATE_KEY_ALIASES: Record<string, string> = {
  'voice-hints': 'voiceHints',
  voicehints: 'voiceHints',
  'copy-rules': 'copyRules',
  copyrules: 'copyRules',
  'theme.accentalt': 'theme.accentAlt',
  'theme.fontheading': 'theme.fontHeading',
  'theme.fontbody': 'theme.fontBody',
  'theme.alt': 'theme.accentAlt',
};

export class TemplatePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplatePatchError';
  }
}

/**
 * Apply one `key=value` pair to a spec. Returns the patched spec WITHOUT
 * validating — call `validateSpec` (or pass to saveTemplate) to validate.
 */
export function applyOnePatch(spec: TemplateSpec, key: string, value: string): TemplateSpec {
  const canonical = canonicalTemplateKey(key);
  // Top-level scalars
  if (TOP_LEVEL.has(canonical)) {
    const v = value === '' ? undefined : value;
    return { ...spec, [canonical]: v } as TemplateSpec;
  }
  // theme.X
  if (canonical.startsWith('theme.')) {
    const tk = canonical.slice('theme.'.length);
    if (!THEME_KEYS.has(tk)) {
      throw new TemplatePatchError(
        `Unknown theme key "${tk}". Valid: ${[...THEME_KEYS].join(', ')}.`,
      );
    }
    let coerced: unknown = value;
    if (tk === 'tone') {
      if (!TONE_VALUES.includes(value as (typeof TONE_VALUES)[number])) {
        throw new TemplatePatchError(`Invalid tone "${value}". Valid: ${TONE_VALUES.join(', ')}.`);
      }
      coerced = value;
    } else if (tk === 'aspect') {
      if (value !== '16:9' && value !== '4:3') {
        throw new TemplatePatchError(`Invalid aspect "${value}". Valid: 16:9, 4:3.`);
      }
      coerced = value;
    }
    return { ...spec, theme: { ...spec.theme, [tk]: coerced as never } };
  }
  // assets.X
  if (canonical.startsWith('assets.')) {
    const ak = canonical.slice('assets.'.length);
    if (!ASSET_KEYS.has(ak)) {
      throw new TemplatePatchError(
        `Unknown assets key "${ak}". Valid: ${[...ASSET_KEYS].join(', ')}.`,
      );
    }
    const next = { ...(spec.assets ?? {}) };
    if (value === '') delete next[ak as keyof typeof next];
    else next[ak as keyof typeof next] = value;
    const hasAny = Object.values(next).some((v) => v !== undefined && v !== '');
    return { ...spec, assets: hasAny ? next : undefined };
  }
  throw new TemplatePatchError(
    `Unknown key "${key}". Settable keys: ${listSettableKeys().join(', ')}.`,
  );
}

/** Apply multiple `--set key=value` strings in order, validating at the end. */
export function applyPatches(spec: TemplateSpec, patches: string[]): TemplateSpec {
  let next = spec;
  for (const p of patches) {
    const eq = p.indexOf('=');
    if (eq < 0) {
      throw new TemplatePatchError(`Bad patch "${p}" — expected key=value.`);
    }
    const key = p.slice(0, eq).trim();
    const value = p.slice(eq + 1);
    next = applyOnePatch(next, key, value);
  }
  const result = TemplateSpecSchema.safeParse(next);
  if (!result.success) {
    throw new TemplatePatchError(`Validation failed:\n${formatZodError(result.error)}`);
  }
  return result.data;
}

function canonicalTemplateKey(key: string): string {
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  if (lower in TEMPLATE_KEY_ALIASES) return TEMPLATE_KEY_ALIASES[lower];
  return trimmed;
}

export function listSettableKeys(): string[] {
  const out: string[] = [];
  for (const k of TOP_LEVEL) out.push(k);
  for (const k of THEME_KEYS) out.push(`theme.${k}`);
  for (const k of ASSET_KEYS) out.push(`assets.${k}`);
  return out;
}
