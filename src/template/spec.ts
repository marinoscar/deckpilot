/**
 * TemplateSpec — a named, persistent style configuration stored under
 * `~/.deckpilot/templates/<name>/template.json` alongside an optional
 * `assets/` directory.
 *
 * The spec carries everything the LLM needs to honour a brand or aesthetic
 * across decks: palette, fonts, aspect, tone, and (optionally) logo asset
 * paths plus free-form voice / copy / guidance text that gets appended to
 * the system prompt at session start (same surface as DECKPILOT.md).
 *
 * Logo paths inside the JSON are RELATIVE to the template directory.
 * `loadTemplate` resolves them to absolute paths before handing the spec to
 * the renderer.
 */
import { z } from 'zod';
import { ThemeSchema } from '../deck/theme.js';

const TemplateName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Template names must be lower-case kebab (letters, digits, hyphens).');

const ShortText = z.string().min(1).max(160);
const RelativePath = z
  .string()
  .min(1)
  .max(256)
  .refine((p) => !p.includes('..') && !p.startsWith('/'), {
    message: 'Asset paths must be relative to the template directory (no "..", no leading "/").',
  });
const Guidance = z.string().max(4096);

export const TemplateAssetsSchema = z.object({
  logo: RelativePath.optional().describe(
    'Primary brand mark. Path relative to the template dir, e.g. "assets/logo.png".',
  ),
  wordmark: RelativePath.optional().describe('Wordmark / type lockup if separate from the logo.'),
  background: RelativePath.optional().describe('Optional background image used on covers or section dividers.'),
});
export type TemplateAssets = z.infer<typeof TemplateAssetsSchema>;

export const TemplateSpecSchema = z.object({
  schemaVersion: z.literal('1.0').default('1.0'),
  name: TemplateName.describe('Must equal the parent directory name.'),
  description: ShortText.optional().describe('One-line summary shown in the template picker.'),
  brand: ShortText.optional().describe('Brand name (e.g. "Acme Corp").'),
  theme: ThemeSchema,
  assets: TemplateAssetsSchema.optional(),
  voiceHints: z
    .string()
    .max(1024)
    .optional()
    .describe('1-3 sentences nudging copy voice. Appended verbatim to the system prompt.'),
  copyRules: z
    .string()
    .max(2048)
    .optional()
    .describe('Bullet list of must/never rules ("never use "utilize"; always capitalize "Cloud"").'),
  guidance: Guidance.optional().describe(
    'Long-form style guidance — composition habits, taboos, references. Appended to the system prompt.',
  ),
});
export type TemplateSpec = z.infer<typeof TemplateSpecSchema>;

/**
 * TemplateSpec with logo/wordmark/background resolved to absolute paths.
 * Produced by `loadTemplate`; consumed by the renderer + slide-api.
 */
export type ResolvedTemplate = Omit<TemplateSpec, 'assets'> & {
  /** Absolute paths or `undefined` if the asset didn't exist on disk. */
  assets?: {
    logo?: string;
    wordmark?: string;
    background?: string;
  };
  /** Absolute path of the template directory the spec was loaded from. */
  rootDir: string;
};

/**
 * Stub spec with safe defaults — used by the CLI's "create from scratch"
 * flow so the user has a starting point to edit by hand.
 */
export function blankTemplate(name: string): TemplateSpec {
  return TemplateSpecSchema.parse({
    name,
    description: 'A new DeckPilot template — edit this file to taste.',
    theme: {
      accent: '1A2B5E',
      accentAlt: 'C8202E',
      ink: '1F2328',
      muted: '6E7781',
      paper: 'FFFFFF',
      fontHeading: 'Inter Tight',
      fontBody: 'Inter',
      tone: 'editorial',
      aspect: '16:9',
    },
  });
}

/** Pretty-print a ZodError, matching the format used elsewhere in the codebase. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `  ${path}: ${i.message}`;
    })
    .join('\n');
}

/** Compact one-line summary for the picker / `template list`. */
export function summarizeTemplate(spec: TemplateSpec): string {
  const t = spec.theme;
  const palette = `#${t.accent} + #${t.accentAlt}`;
  const fonts = `${t.fontHeading} / ${t.fontBody}`;
  const tail = spec.brand ? ` · ${spec.brand}` : '';
  return `${spec.name}${tail} — ${palette}, ${fonts}, ${t.tone}`;
}
