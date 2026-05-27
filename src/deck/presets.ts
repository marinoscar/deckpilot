import type { DesignSystem } from './schema.js';

/**
 * Named DesignSystem presets. Five distinct, deliberately-tuned design
 * languages the LLM can pick from instead of inventing one from scratch.
 * Each preset is a complete, valid DesignSystem.
 *
 * Picking a preset gives the LLM a stylistically distinct starting point;
 * it can still tweak individual fields via apply_design_preset's overrides
 * or call set_design_system later for a fully custom system.
 */
export type PresetName =
  | 'editorial'
  | 'minimal-executive'
  | 'energetic-startup'
  | 'corporate-blue'
  | 'studious-academic';

export const PRESET_NAMES: PresetName[] = [
  'editorial',
  'minimal-executive',
  'energetic-startup',
  'corporate-blue',
  'studious-academic',
];

export const PRESETS: Record<PresetName, DesignSystem> = {
  // Inspired by the user-supplied reference images: navy + red, generous
  // cards with side-bars, kickers everywhere, footer band on every page.
  editorial: {
    accent: '1A2B5E',
    accentAlt: 'C8202E',
    ink: '1F2328',
    muted: '6E7781',
    paper: 'FFFFFF',
    cardTint: 'EBF0FA',
    cardTintAlt: 'FBEDEF',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter',
    tone: 'editorial',
    useKickers: true,
    useFooterBand: true,
    cornerAccents: false,
    numberStyle: 'circle',
    cardStyle: 'side-bar',
  },

  // Restrained executive look. Single charcoal accent, minimal chrome, big
  // type, no kickers, no footer chatter. McKinsey-ish.
  'minimal-executive': {
    accent: '1F2937',
    accentAlt: 'D97706',
    ink: '111827',
    muted: '6B7280',
    paper: 'FFFFFF',
    cardTint: 'F3F4F6',
    cardTintAlt: 'FDF2D9',
    fontHeading: 'Inter',
    fontBody: 'Inter',
    tone: 'minimal',
    useKickers: false,
    useFooterBand: false,
    cornerAccents: false,
    numberStyle: 'circle',
    cardStyle: 'plain',
  },

  // Bright, optimistic, startup-pitch energy. Magenta + cyan, top-bar cards,
  // corner accents for visual punctuation. Suits product launches.
  'energetic-startup': {
    accent: 'E11D48',
    accentAlt: '0EA5E9',
    ink: '0F172A',
    muted: '64748B',
    paper: 'FFFFFF',
    cardTint: 'FDE4E7',
    cardTintAlt: 'E0F2FE',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter',
    tone: 'energetic',
    useKickers: true,
    useFooterBand: false,
    cornerAccents: true,
    numberStyle: 'pill',
    cardStyle: 'top-bar',
  },

  // Classic enterprise. IBM Carbon blue, neutral greys, balanced and a
  // little formal. Works for board updates and customer-facing decks.
  'corporate-blue': {
    accent: '0F62FE',
    accentAlt: '002D9C',
    ink: '161616',
    muted: '525252',
    paper: 'FFFFFF',
    cardTint: 'EBF1FF',
    cardTintAlt: 'E1ECFF',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter',
    tone: 'corporate',
    useKickers: true,
    useFooterBand: true,
    cornerAccents: false,
    numberStyle: 'circle',
    cardStyle: 'side-bar',
  },

  // Quiet, considered, scholarly. Deep green + warm sand, serif headings,
  // generous kickers. For research write-ups, lectures, technical deep-dives.
  'studious-academic': {
    accent: '14532D',
    accentAlt: 'A16207',
    ink: '1C1917',
    muted: '78716C',
    paper: 'FAFAF7',
    cardTint: 'EEEEE5',
    cardTintAlt: 'F5EBD3',
    fontHeading: 'Playfair Display',
    fontBody: 'Source Sans Pro',
    tone: 'studious',
    useKickers: true,
    useFooterBand: true,
    cornerAccents: false,
    numberStyle: 'circle',
    cardStyle: 'side-bar',
  },
};

export function describePreset(name: PresetName): string {
  switch (name) {
    case 'editorial':
      return 'editorial · navy + red, kickers, side-bar cards, footer band on every slide';
    case 'minimal-executive':
      return 'minimal-executive · charcoal + amber, no kickers, no chrome, big type';
    case 'energetic-startup':
      return 'energetic-startup · magenta + cyan, top-bar cards, corner accents, pill numbers';
    case 'corporate-blue':
      return 'corporate-blue · IBM Carbon blue, balanced and formal';
    case 'studious-academic':
      return 'studious-academic · deep green + amber, serif headings, scholarly';
  }
}

export function listPresets(): { name: PresetName; description: string }[] {
  return PRESET_NAMES.map((n) => ({ name: n, description: describePreset(n) }));
}
