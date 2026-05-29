/**
 * Named colour tokens for the DeckPilot TUI. Every screen should pull its
 * colours from here instead of hard-coding `"cyanBright"` etc, so we can
 * re-skin the whole app in one edit and keep a coherent palette.
 *
 * These names map to ink/Chalk colour strings. Backgrounds use the same
 * names (just passed to `backgroundColor` in Box).
 */
export const Theme = {
  /** Primary brand accent. Used for panel borders, focused row text, and the title. */
  primary: 'cyanBright',
  /** Secondary accent. Used for template names and "kind" labels. */
  accent: 'magenta',
  /** Success / confirmation. Used for "Saved", "Deleted", checked rows. */
  success: 'green',
  /** Warnings and transient status messages. */
  warn: 'yellow',
  /** Errors. Used for inline validation failures and destructive panels. */
  error: 'red',
  /** Decorative grey for dim/muted text — ink's `dimColor` is preferred where possible. */
  muted: 'gray',
  /** Project name highlight (distinct from accent so projects ≠ templates visually). */
  project: 'cyanBright',
  /** Template name highlight. */
  template: 'magenta',
} as const;

export type ThemeKey = keyof typeof Theme;
