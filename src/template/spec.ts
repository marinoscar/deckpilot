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

// Six hex digits, no leading #. Same shape as ThemeSchema's hex fields so the
// LLM and our parsers see one canonical format everywhere.
const HexColor = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'Hex colour without leading # — six hex digits, e.g. "1A2B5E".');

// Numeric position/size, in inches. Matches pptxgenjs's units. We allow a
// generous range so extracted shapes from non-standard slide sizes still fit.
const Inches = z.number().finite().min(-100).max(100);

/**
 * Brand-master objects we know how to deterministically extract from a source
 * .pptx AND re-emit via pptxgenjs's `defineSlideMaster({ objects })`. The list
 * is intentionally narrow — only shapes the renderer can faithfully reproduce.
 */
export const MasterObjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    src: RelativePath,
    x: Inches,
    y: Inches,
    w: Inches,
    h: Inches,
  }),
  z.object({
    kind: z.literal('rect'),
    x: Inches,
    y: Inches,
    w: Inches,
    h: Inches,
    fill: HexColor,
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(240),
    x: Inches,
    y: Inches,
    w: Inches,
    h: Inches,
    fontFace: z.string().min(1).max(64).optional(),
    fontSize: z.number().int().min(4).max(200).optional(),
    bold: z.boolean().optional(),
    color: HexColor.optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  }),
]);
export type MasterObject = z.infer<typeof MasterObjectSchema>;

export const MasterBackgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: HexColor }),
  z.object({ type: z.literal('image'), src: RelativePath }),
]);
export type MasterBackground = z.infer<typeof MasterBackgroundSchema>;

/**
 * Brand chrome applied via pptxgenjs's slide master. When present, the
 * renderer calls `defineSlideMaster` once and every generated slide inherits
 * these visuals automatically — the LLM no longer needs to redraw the logo,
 * background, or footer band in slide code.
 */
export const MasterSchema = z
  .object({
    /**
     * Content / all-slides background. Painted on every generated slide via
     * pptxgenjs's slide master. When `coverBackground` is also present, the
     * renderer overrides this on cover + section-divider slides.
     */
    background: MasterBackgroundSchema.optional(),
    /**
     * Cover/divider background. Overrides `background` on the cover slide and
     * section dividers (slides whose brief `role` is 'cover'/'divider', or
     * slide 1 when no role is set). Absent → those slides share `background`.
     */
    coverBackground: MasterBackgroundSchema.optional(),
    objects: z.array(MasterObjectSchema).max(32).optional(),
  })
  .refine(
    (m) =>
      m.background !== undefined || m.coverBackground !== undefined || (m.objects?.length ?? 0) > 0,
    { message: 'master must define at least one of background, coverBackground, or objects.' },
  );
export type Master = z.infer<typeof MasterSchema>;

/**
 * One source-slide layout descriptor. The vision pass authors `summary`; the
 * OOXML extractor authors everything else. Shown to the code-gen LLM at chat
 * time as the source deck's "layout vocabulary".
 */
export const DonorShapeSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['text', 'image', 'rect', 'table', 'chart', 'group', 'other']),
  x: Inches,
  y: Inches,
  w: Inches,
  h: Inches,
  placeholder: z.string().min(1).max(40).optional(),
  fontFace: z.string().min(1).max(64).optional(),
  fontSize: z.number().int().min(4).max(200).optional(),
  bold: z.boolean().optional(),
  fillColor: HexColor.optional(),
  textColor: HexColor.optional(),
  sampleText: z.string().max(120).optional(),
});
export type DonorShape = z.infer<typeof DonorShapeSchema>;

export const DonorGeometrySchema = z.object({
  index: z.number().int().min(0).max(999),
  name: z.string().min(1).max(120),
  layoutName: z.string().min(1).max(120).optional(),
  summary: z.string().max(240).default(''),
  shapes: z.array(DonorShapeSchema).max(6),
});
export type DonorGeometry = z.infer<typeof DonorGeometrySchema>;

/**
 * The donor deck's canonical theme colour scheme (OOXML `a:clrScheme`) —
 * the ~8-10 brand swatches PowerPoint exposes in its colour picker. Captured
 * verbatim from `theme1.xml` and surfaced to the code-gen LLM as the brand's
 * named palette, alongside the usage-frequency `paletteSamples`. The renderable
 * `theme` (accent / accentAlt / ink / muted / paper) maps a 5-colour subset of
 * this; the rest (accent4-6, hyperlinks) live here as context only.
 */
export const ThemePaletteSchema = z.object({
  dk1: HexColor.optional(),
  lt1: HexColor.optional(),
  dk2: HexColor.optional(),
  lt2: HexColor.optional(),
  accent1: HexColor.optional(),
  accent2: HexColor.optional(),
  accent3: HexColor.optional(),
  accent4: HexColor.optional(),
  accent5: HexColor.optional(),
  accent6: HexColor.optional(),
  hyperlink: HexColor.optional(),
  followedHyperlink: HexColor.optional(),
});
export type ThemePalette = z.infer<typeof ThemePaletteSchema>;

export const TemplateAssetsSchema = z.object({
  logo: RelativePath.optional().describe(
    'Primary brand mark. Path relative to the template dir, e.g. "assets/logo.png".',
  ),
  wordmark: RelativePath.optional().describe('Wordmark / type lockup if separate from the logo.'),
  background: RelativePath.optional().describe(
    'Optional background image used on covers or section dividers.',
  ),
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
    .describe(
      'Bullet list of must/never rules ("never use "utilize"; always capitalize "Cloud"").',
    ),
  guidance: Guidance.optional().describe(
    'Long-form style guidance — composition habits, taboos, references. Appended to the system prompt.',
  ),
  master: MasterSchema.optional().describe(
    'Brand chrome applied via pptxgenjs defineSlideMaster — logo, background, footer band. When present, every generated slide inherits these automatically.',
  ),
  paletteSamples: z
    .array(HexColor)
    .max(12)
    .optional()
    .describe(
      'Distinct colours the source deck uses prominently (cards, chart series, etc.). The code-gen LLM picks from this list instead of inventing.',
    ),
  themePalette: ThemePaletteSchema.optional().describe(
    "The source deck's canonical theme colour scheme (theme1.xml clrScheme) — the named brand swatches (accent1-6, dark/light, hyperlinks). Surfaced to the code-gen LLM as the brand palette.",
  ),
  donorGeometry: z
    .array(DonorGeometrySchema)
    .max(40)
    .optional()
    .describe(
      "Per-source-slide layout descriptors. The code-gen LLM sees this as the source deck's layout vocabulary and reproduces or extends entries when authoring.",
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
