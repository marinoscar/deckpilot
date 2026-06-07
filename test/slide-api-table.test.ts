import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/deck/theme.js';
import { buildSlideProxy } from '../src/render/slide-api.js';

const THEME: Theme = {
  accent: '1A2B5E',
  accentAlt: 'C8202E',
  ink: '1F2328',
  muted: '6E7781',
  paper: 'FFFFFF',
  fontHeading: 'Inter Tight',
  fontBody: 'Inter',
  tone: 'editorial',
  aspect: '16:9',
};

/** Fake slide that records the args addTable was ultimately invoked with. */
function fakeSlide() {
  const calls: unknown[][] = [];
  // biome-ignore lint/suspicious/noExplicitAny: recording shim
  const slide: any = {
    addTable: (...args: unknown[]) => calls.push(args),
  };
  return { slide, calls };
}

const ROWS = [
  ['Quarter', 'Revenue'],
  ['Q1', '120'],
  ['Q2', '155'],
];

/**
 * pptxgenjs emits <a:tr h="0"> when no row height is given, which strict
 * rasterisers (the pptx-glimpse preview renderer) collapse into overlapping
 * rows. buildSlideProxy injects a default rowH so the preview lays rows out.
 */
describe('addTable row-height normalization', () => {
  it('injects a positive default rowH when none is given', () => {
    const { slide, calls } = fakeSlide();
    const proxy = buildSlideProxy(slide, THEME);
    proxy.addTable(ROWS, { x: 0.5, y: 1, w: 5 });
    const opts = calls[0]![1] as Record<string, unknown>;
    expect(typeof opts.rowH).toBe('number');
    expect(opts.rowH as number).toBeGreaterThan(0);
  });

  it('scales the default rowH with fontSize', () => {
    const { slide, calls } = fakeSlide();
    const proxy = buildSlideProxy(slide, THEME);
    proxy.addTable(ROWS, { fontSize: 12 });
    proxy.addTable(ROWS, { fontSize: 32 });
    const small = (calls[0]![1] as Record<string, number>).rowH;
    const large = (calls[1]![1] as Record<string, number>).rowH;
    expect(large).toBeGreaterThan(small);
  });

  it('respects an explicit rowH', () => {
    const { slide, calls } = fakeSlide();
    const proxy = buildSlideProxy(slide, THEME);
    proxy.addTable(ROWS, { rowH: 1.25 });
    expect((calls[0]![1] as Record<string, number>).rowH).toBe(1.25);
  });

  it('does not inject rowH when a total table height is given', () => {
    const { slide, calls } = fakeSlide();
    const proxy = buildSlideProxy(slide, THEME);
    proxy.addTable(ROWS, { h: 3 });
    expect('rowH' in (calls[0]![1] as object)).toBe(false);
  });

  it('supplies an options bag even when the author passed none', () => {
    const { slide, calls } = fakeSlide();
    const proxy = buildSlideProxy(slide, THEME);
    proxy.addTable(ROWS);
    const opts = calls[0]![1] as Record<string, unknown>;
    expect(opts).toBeTypeOf('object');
    expect(opts.rowH as number).toBeGreaterThan(0);
  });
});
