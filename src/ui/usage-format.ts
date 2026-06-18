/**
 * Pure formatting helpers shared by the status-bar context gauge and the
 * `/context` report. Kept UI-agnostic (plain strings + colour names) so both
 * the compact indicator and the full report draw from one source of truth.
 */

/** Full grouped count, e.g. 48120 → "48,120". */
export function fmtFull(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Compact count for tight spaces, e.g. 48120 → "48.1k", 1_280_000 → "1.3M". */
export function fmtCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Fraction 0..1 of the context window in use (clamped). 0 when no limit known. */
export function fillFraction(currentTokens: number, tokenLimit: number): number {
  if (!tokenLimit || tokenLimit <= 0) return 0;
  return Math.max(0, Math.min(1, currentTokens / tokenLimit));
}

/** A solid/empty unicode meter, e.g. gauge(0.4, 10) → "████░░░░░░". */
export function gauge(fraction: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** ink colour name for a fill fraction: green (roomy) → yellow → red (tight). */
export function fillColor(fraction: number): 'green' | 'yellow' | 'red' {
  if (fraction >= 0.85) return 'red';
  if (fraction >= 0.6) return 'yellow';
  return 'green';
}

/** Whole-percent string for a fraction, e.g. 0.382 → "38%". */
export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
