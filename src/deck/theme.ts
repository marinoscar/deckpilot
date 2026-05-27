/**
 * Theme — the deck-wide visual guideline passed into LLM-generated slide code.
 *
 * In the code-gen world the LLM invents these values once per deck (with
 * optional input from a DECKPILOT.md style guide or an inspected .pptx
 * template). Per-slide rendering code reads `theme` to drive every visual
 * decision — palette, fonts, slide canvas size.
 *
 * No deterministic decorative habits live here. Things like "use a footer
 * band" or "side-bar accent on cards" are choices the LLM makes inside the
 * slide code, not flags the renderer reads.
 */
import { z } from 'zod';

const HexColor = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'Hex colour without leading # — six hex digits, e.g. "1A2B5E".');

const ToneHint = z.enum([
  'editorial',
  'minimal',
  'corporate',
  'energetic',
  'studious',
  'playful',
  'luxe',
]);

export const ThemeSchema = z.object({
  accent: HexColor.describe('Primary brand colour. Drives titles, primary shapes, key emphasis.'),
  accentAlt: HexColor.describe('Secondary accent. Pair complementary — never twin the primary.'),
  ink: HexColor.default('1F2328').describe('Body text — near-black, easier on eyes than #000.'),
  muted: HexColor.default('6E7781').describe('Captions, page numbers, dividers, secondary text.'),
  paper: HexColor.default('FFFFFF').describe('Slide background colour.'),

  fontHeading: z.string().min(1).max(64).default('Inter Tight'),
  fontBody: z.string().min(1).max(64).default('Inter'),

  tone: ToneHint.default('editorial').describe(
    'Voice hint shaping copy, not a layout switch. Layout choices live in the slide code itself.',
  ),

  aspect: z.union([z.literal('16:9'), z.literal('4:3')]).default('16:9'),
});
export type Theme = z.infer<typeof ThemeSchema>;

/** 16:9 widescreen = 13.333" × 7.5" — pptxgenjs LAYOUT_WIDE. */
export const SLIDE_W_16_9 = 13.333;
export const SLIDE_H_16_9 = 7.5;
/** 4:3 standard = 10" × 7.5" — pptxgenjs LAYOUT_STANDARD. */
export const SLIDE_W_4_3 = 10;
export const SLIDE_H_4_3 = 7.5;

export function slideSizeForTheme(theme: Theme): { w: number; h: number } {
  return theme.aspect === '4:3'
    ? { w: SLIDE_W_4_3, h: SLIDE_H_4_3 }
    : { w: SLIDE_W_16_9, h: SLIDE_H_16_9 };
}

/**
 * Compute a readable text colour over the given background hex. Uses the
 * standard YIQ luminance approximation; below the threshold we return the
 * theme's paper, above we return its ink.
 */
export function contrastInk(bgHex: string, theme: Theme): string {
  const { r, g, b } = hexToRgb(bgHex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 140 ? theme.paper : theme.ink;
}

export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp01(amount);
  return rgbToHex(
    Math.round(r + (255 - r) * a),
    Math.round(g + (255 - g) * a),
    Math.round(b + (255 - b) * a),
  );
}

export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp01(amount);
  return rgbToHex(Math.round(r * (1 - a)), Math.round(g * (1 - a)), Math.round(b * (1 - a)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, '');
  const n = Number.parseInt(clean, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
