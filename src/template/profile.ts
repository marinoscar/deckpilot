/**
 * TemplateProfile — what DeckPilot extracts from a user-supplied `.pptx` to
 * inform a future render. Theme colours, fonts, slide size. Layout names are
 * included for diagnostics but not yet driven through the renderer (M3 keeps
 * to DeckPilot's own layout taxonomy; M4+ may map a user template's layouts
 * onto ours).
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
};

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
