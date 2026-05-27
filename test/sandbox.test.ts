import { describe, expect, it } from 'vitest';
import type { Theme } from '../src/deck/theme.js';
import { SlideCodeError, runSlideCode } from '../src/render/sandbox.js';

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

/**
 * Build a tiny fake pptx slide that records every method call + the
 * `background` assignment so the test can assert what the LLM code did
 * without dragging pptxgenjs into the test.
 */
function fakeSlide() {
  const calls: { method: string; args: unknown[] }[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: explicit recording shim
  const slide: any = {
    background: undefined as unknown,
    addText: (...args: unknown[]) => calls.push({ method: 'addText', args }),
    addShape: (...args: unknown[]) => calls.push({ method: 'addShape', args }),
    addImage: (...args: unknown[]) => calls.push({ method: 'addImage', args }),
    addTable: (...args: unknown[]) => calls.push({ method: 'addTable', args }),
    addChart: (...args: unknown[]) => calls.push({ method: 'addChart', args }),
    addNotes: (...args: unknown[]) => calls.push({ method: 'addNotes', args }),
  };
  return { slide, calls };
}

describe('runSlideCode', () => {
  it('executes a render() function against the proxy', () => {
    const { slide, calls } = fakeSlide();
    runSlideCode(
      `function render(slide, theme, helpers) {
        slide.background = { color: theme.accent };
        slide.addText('Hello', { x: 0.5, y: 0.5, w: 4, h: 1, fontSize: 32 });
      }`,
      slide,
      THEME,
      's1',
    );
    expect(slide.background).toEqual({ color: '1A2B5E' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('addText');
  });

  it('executes bare statements (no render function declaration)', () => {
    const { slide, calls } = fakeSlide();
    runSlideCode(
      `slide.addShape('rect', { x: 0, y: 0, w: 13, h: 7.5, fill: { color: theme.accent } });`,
      slide,
      THEME,
      's2',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('addShape');
  });

  it('rejects access to methods outside the whitelist', () => {
    const { slide } = fakeSlide();
    expect(() =>
      runSlideCode('slide.addEvilThing && slide.addEvilThing();', slide, THEME, 's3'),
    ).toThrow(SlideCodeError);
  });

  it('blocks require / global access', () => {
    const { slide } = fakeSlide();
    expect(() =>
      runSlideCode(`require('fs').readFileSync('/etc/hosts');`, slide, THEME, 's4'),
    ).toThrow(SlideCodeError);
    expect(() => runSlideCode('process.env.HOME;', slide, THEME, 's5')).toThrow(SlideCodeError);
  });

  it('rejects malformed hex colours via the proxy', () => {
    const { slide } = fakeSlide();
    expect(() =>
      runSlideCode(
        `slide.addText('x', { x: 0, y: 0, w: 1, h: 1, color: '#1A2B5E' });`,
        slide,
        THEME,
        's6',
      ),
    ).toThrow(/6-digit hex/);
  });

  it('rejects non-finite coordinates', () => {
    const { slide } = fakeSlide();
    expect(() =>
      runSlideCode(`slide.addText('x', { x: NaN, y: 0, w: 1, h: 1 });`, slide, THEME, 's7'),
    ).toThrow(/finite number/);
  });

  it('passes helpers — lighten / contrastInk work', () => {
    const { slide, calls } = fakeSlide();
    runSlideCode(
      `slide.addText('x', { x: 0, y: 0, w: 1, h: 1, color: helpers.contrastInk(theme.accent) });`,
      slide,
      THEME,
      's8',
    );
    // Accent is navy → contrastInk should return paper (white).
    const opts = calls[0]!.args[1] as { color: string };
    expect(opts.color).toBe('FFFFFF');
  });

  it('disallows dynamic code generation (eval / new Function)', () => {
    const { slide } = fakeSlide();
    expect(() =>
      runSlideCode(`eval("slide.addText('x', { x: 0, y: 0, w: 1, h: 1 })");`, slide, THEME, 's9'),
    ).toThrow(SlideCodeError);
  });
});
