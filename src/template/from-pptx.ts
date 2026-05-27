/**
 * Bridge from a user-supplied `.pptx` to a fresh `TemplateSpec`.
 *
 * Reuses `inspectTemplate` (OOXML reader) for the actual extraction; this
 * module's job is shape-mapping: TemplateProfile (the inspector's output)
 * → TemplateSpec (the persistent format). The user is expected to edit the
 * resulting JSON to add logos / voice / brand metadata that don't live in
 * a .pptx theme part.
 */
import { inspectTemplate } from './inspect.js';
import { TemplateSpecSchema, type TemplateSpec } from './spec.js';

/**
 * Build a TemplateSpec from a .pptx on disk. Palette, fonts, and aspect are
 * pulled from the OOXML; everything else (assets, voice, brand) is left
 * empty for the user to fill in.
 *
 * The returned spec is validated; the caller decides where to write it (the
 * CLI command writes via `saveTemplate`, the LLM tool writes via
 * `saveTemplate` directly).
 */
export async function templateFromPptx(
  name: string,
  pptxPath: string,
  opts: { description?: string; brand?: string } = {},
): Promise<TemplateSpec> {
  const profile = await inspectTemplate(pptxPath);

  const aspect: '16:9' | '4:3' = profile.aspect === '4:3' ? '4:3' : '16:9';

  const draft = {
    schemaVersion: '1.0' as const,
    name,
    description:
      opts.description ?? `Imported from ${pptxPath.split('/').pop() ?? pptxPath}.`,
    brand: opts.brand,
    theme: {
      accent: profile.colors.accent,
      // Inspector emits accentDark; we use it as accentAlt. If absent we
      // fall back to the same hue darkened — the user will likely refine.
      accentAlt: profile.colors.accentDark ?? darkenForFallback(profile.colors.accent),
      ink: profile.colors.ink ?? '1F2328',
      muted: profile.colors.muted ?? '6E7781',
      paper: profile.colors.paper ?? 'FFFFFF',
      fontHeading: profile.fonts.heading,
      fontBody: profile.fonts.body,
      tone: 'editorial' as const,
      aspect,
    },
  };

  const parsed = TemplateSpecSchema.safeParse(draft);
  if (!parsed.success) {
    // Should not happen — inspector outputs always validate. But surface
    // anything weird with full context.
    throw new Error(
      `Imported template failed validation:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}

/** Darken a 6-digit hex by ~25% for the accentAlt fallback. */
function darkenForFallback(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const k = 0.75;
  return [
    Math.round(r * k),
    Math.round(g * k),
    Math.round(b * k),
  ]
    .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}
