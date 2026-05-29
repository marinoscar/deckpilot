import type { DonorGeometry, Master, ResolvedTemplate } from './spec.js';

/**
 * TemplateProfile — what DeckPilot extracts from a user-supplied `.pptx` to
 * inform a future render. Theme colours, fonts, slide size. Layout names are
 * included for diagnostics but not yet driven through the renderer (M3 keeps
 * to DeckPilot's own layout taxonomy; M4+ may map a user template's layouts
 * onto ours).
 *
 * v0.16 adds three extraction-only fields used by the persistent TemplateSpec
 * (the renderer's `master` path inherits brand chrome via pptxgenjs's
 * defineSlideMaster, and the chat surface shows the LLM the working palette
 * + the source deck's layout vocabulary).
 */
export type TemplateProfile = {
  /** Absolute path the profile was loaded from. */
  sourcePath: string;
  /** Slide size as a 16:9 / 4:3 ratio inferred from EMU dimensions, when possible. */
  aspect: '16:9' | '4:3' | 'other';
  /** Slide size in inches, rounded to two decimals. */
  slideSize: { width: number; height: number };
  /** Six-digit hex strings (no leading #). */
  colors: {
    accent: string;
    accentDark?: string;
    ink?: string;
    muted?: string;
    paper?: string;
  };
  /** Major (heading) and minor (body) typeface names from the theme's fontScheme. */
  fonts: { heading: string; body: string };
  /** Layout names found in the master. Surfaced to the LLM as a hint, even though M3 doesn't strictly map onto them. */
  layoutNames: string[];
  /** Brand chrome (background + logo/footer objects) — applied via pptxgenjs defineSlideMaster. */
  master?: Master;
  /** Distinct colours used prominently across slides, sorted by frequency. */
  paletteSamples?: string[];
  /** Per-source-slide layout descriptors (LLM-facing layout vocabulary). */
  donorGeometry?: DonorGeometry[];
  /** Asset-path entries written into `<templateRootDir>/assets/` during extraction. */
  copiedAssets?: string[];
  /**
   * Template directory on disk, when the profile was loaded from a named
   * template under `~/.deckpilot/templates/<name>/`. The renderer joins
   * relative `master.objects[*].src` paths against this when calling
   * pptxgenjs. Absent for one-shot profiles loaded directly from a .pptx
   * (those won't have image master objects since there's no place to copy
   * the media to).
   */
  rootDir?: string;
};

/**
 * Convert a persisted `ResolvedTemplate` (loaded from
 * ~/.deckpilot/templates/<name>/) into a `TemplateProfile` the renderer can
 * consume. Brings the master / paletteSamples / donorGeometry fields across
 * so master inheritance kicks in for named templates.
 */
export function profileFromResolved(resolved: ResolvedTemplate): TemplateProfile {
  return {
    sourcePath: resolved.rootDir,
    aspect: resolved.theme.aspect === '4:3' ? '4:3' : '16:9',
    slideSize:
      resolved.theme.aspect === '4:3'
        ? { width: 10, height: 7.5 }
        : { width: 13.33, height: 7.5 },
    colors: {
      accent: resolved.theme.accent,
      accentDark: resolved.theme.accentAlt,
      ink: resolved.theme.ink,
      muted: resolved.theme.muted,
      paper: resolved.theme.paper,
    },
    fonts: {
      heading: resolved.theme.fontHeading,
      body: resolved.theme.fontBody,
    },
    layoutNames: [],
    ...(resolved.master ? { master: resolved.master } : {}),
    ...(resolved.paletteSamples ? { paletteSamples: resolved.paletteSamples } : {}),
    ...(resolved.donorGeometry ? { donorGeometry: resolved.donorGeometry } : {}),
    rootDir: resolved.rootDir,
  };
}

/**
 * Compact one-paragraph summary suitable for injection into the LLM system
 * prompt so it knows what palette / fonts / layouts it's authoring against.
 */
export function summarizeTemplate(p: TemplateProfile): string {
  const layouts = p.layoutNames.length
    ? `master layouts available: ${p.layoutNames.join(', ')}`
    : 'no named master layouts detected';
  const palette = [
    `accent #${p.colors.accent}`,
    p.colors.accentDark ? `accentDark #${p.colors.accentDark}` : null,
    p.colors.ink ? `ink #${p.colors.ink}` : null,
    p.colors.paper ? `paper #${p.colors.paper}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    `Template loaded from ${p.sourcePath}.`,
    `Aspect: ${p.aspect} (${p.slideSize.width}" × ${p.slideSize.height}").`,
    `Theme: ${palette}.`,
    `Fonts: heading "${p.fonts.heading}", body "${p.fonts.body}".`,
    layouts + '.',
  ].join(' ');
}
