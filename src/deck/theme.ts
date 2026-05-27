/**
 * DeckPilot default theme. Conservative, accessible, designer-friendly defaults
 * that read well in PowerPoint and Keynote. Users will override the theme via
 * a template inspection in M3; for M2 every deck uses these constants.
 *
 * Color palette (IBM Carbon-inspired, accessible):
 *   accent — primary brand color, used for section backgrounds and emphasis
 *   ink    — body text (near-black, soft on eyes vs pure #000)
 *   muted  — secondary text, page numbers, dividers
 *   paper  — slide background
 */
export type Theme = {
  accent: string;
  accentDark: string;
  ink: string;
  muted: string;
  paper: string;
  fontHeading: string;
  fontBody: string;
};

export const DEFAULT_THEME: Theme = {
  accent: '0F62FE',
  accentDark: '002D9C',
  ink: '1F2328',
  muted: '6E7781',
  paper: 'FFFFFF',
  // Inter is widely available on modern systems and substitutes cleanly when
  // it's not. Inter Tight is used for headings for tighter tracking.
  fontHeading: 'Inter Tight',
  fontBody: 'Inter',
};

/**
 * 16:9 widescreen slide dimensions (LAYOUT_WIDE in pptxgenjs).
 * Width 13.333", height 7.5". All layout math in renderers assumes this.
 */
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

/** Horizontal margin used by most layouts. */
export const SIDE_MARGIN = 0.6;
