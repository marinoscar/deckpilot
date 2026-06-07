/**
 * The surface area LLM-generated slide code is allowed to touch.
 *
 * `buildSlideProxy` wraps a real pptxgenjs slide in a Proxy that whitelists
 * the methods we want the model to use. Anything outside the whitelist
 * (`require`, file I/O, prototype walks, etc.) is blocked at the proxy level
 * before the call reaches pptxgenjs.
 *
 * Inputs to whitelisted methods are validated: numeric coords must be finite
 * and within the slide canvas; hex colours must be six clean digits; method
 * argument shapes pass through largely unchanged because pptxgenjs already
 * tolerates a wide variety of option bags.
 */
import { type Theme, contrastInk, darken, lighten } from '../deck/theme.js';

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported Slide type
export type PSlide = any;

const ALLOWED_METHODS = new Set([
  'addText',
  'addShape',
  'addImage',
  'addTable',
  'addChart',
  'addNotes',
]);

const ALLOWED_PROPS = new Set(['background', 'hidden']);

export type SlideProxy = {
  addText: (...args: unknown[]) => void;
  addShape: (...args: unknown[]) => void;
  addImage: (...args: unknown[]) => void;
  addTable: (...args: unknown[]) => void;
  addChart: (...args: unknown[]) => void;
  addNotes: (text: string) => void;
  background: { color: string } | { path: string };
};

/**
 * Wrap a pptxgenjs slide in a Proxy that only exposes the methods/properties
 * the LLM-generated code is allowed to use. Unknown access throws with a
 * descriptive error so the LLM can self-correct.
 */
export function buildSlideProxy(slide: PSlide, theme: Theme): SlideProxy {
  const { w, h } = slideBounds(theme);

  const handler: ProxyHandler<PSlide> = {
    get(target, prop, _receiver) {
      if (typeof prop === 'symbol') return undefined;
      const name = String(prop);
      if (ALLOWED_PROPS.has(name)) {
        return Reflect.get(target, prop);
      }
      if (!ALLOWED_METHODS.has(name)) {
        throw new Error(
          `slide.${name} is not available. Allowed methods: ${[...ALLOWED_METHODS].join(', ')}. Allowed props: ${[...ALLOWED_PROPS].join(', ')}.`,
        );
      }
      return (...args: unknown[]) => {
        validateMethodArgs(name, args, w, h);
        const finalArgs = name === 'addTable' ? normalizeTableArgs(args) : args;
        return Reflect.apply(target[name], target, finalArgs);
      };
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') return false;
      const name = String(prop);
      if (!ALLOWED_PROPS.has(name)) {
        throw new Error(
          `slide.${name} is not assignable. Allowed: ${[...ALLOWED_PROPS].join(', ')}.`,
        );
      }
      if (name === 'background') {
        validateBackground(value);
      }
      Reflect.set(target, prop, value);
      return true;
    },
  };
  return new Proxy(slide, handler) as unknown as SlideProxy;
}

function slideBounds(theme: Theme): { w: number; h: number } {
  return theme.aspect === '4:3' ? { w: 10, h: 7.5 } : { w: 13.333, h: 7.5 };
}

function validateMethodArgs(method: string, args: unknown[], slideW: number, slideH: number): void {
  // pptxgenjs accepts a wide variety of shapes. We focus validation on the
  // common-and-obvious cases: an options bag with x/y/w/h and a colour field.
  // Anything we don't recognise we let through — pptxgenjs will surface its
  // own error message, which we'll bubble back to the LLM via the sandbox.
  if (method === 'addNotes') {
    if (typeof args[0] !== 'string') {
      throw new Error('slide.addNotes(text): text must be a string.');
    }
    return;
  }
  // The options bag is normally the last argument.
  for (const arg of args) {
    if (!arg || typeof arg !== 'object' || Array.isArray(arg)) continue;
    validateOptionsBag(method, arg as Record<string, unknown>, slideW, slideH);
  }
}

/**
 * pptxgenjs emits `<a:tr h="0">` for every row when `addTable` is called
 * without explicit row heights or a total table height. PowerPoint and
 * LibreOffice treat that 0 as a *minimum* and auto-grow each row to fit its
 * content, so it looks fine there — but strict rasterisers (e.g. the
 * pptx-glimpse preview renderer) take h=0 literally and stack every row at the
 * same y, producing an overlapping mess.
 *
 * To keep previews faithful, inject a sensible default `rowH` (inches) when the
 * author specified neither `rowH` nor `h`. This is a *minimum* height, so it
 * doesn't clip taller content in PowerPoint/LibreOffice; for dense multi-line
 * tables the author can still pass an explicit `rowH`.
 */
function normalizeTableArgs(args: unknown[]): unknown[] {
  const rows = args[0];
  const rawOpts = args[1];
  const hasOpts = !!rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts);
  const opts: Record<string, unknown> = hasOpts ? { ...(rawOpts as object) } : {};
  if (!('rowH' in opts) && !('h' in opts)) {
    const fontSize = typeof opts.fontSize === 'number' ? opts.fontSize : 18;
    opts.rowH = defaultRowHeightInches(fontSize);
  }
  return [rows, opts, ...args.slice(2)];
}

/** Default per-row height in inches: ~1.4× line-height plus cell margins. */
function defaultRowHeightInches(fontSizePt: number): number {
  const lineInches = (fontSizePt * 1.4) / 72;
  return Math.round((lineInches + 0.12) * 100) / 100;
}

function validateOptionsBag(
  method: string,
  opts: Record<string, unknown>,
  slideW: number,
  slideH: number,
): void {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (!(k in opts)) continue;
    const v = opts[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`slide.${method} opts.${k} must be a finite number (got ${describe(v)}).`);
    }
    if (v < -slideW || v > slideW * 2) {
      throw new Error(
        `slide.${method} opts.${k}=${v} is wildly out of the ${slideW}"×${slideH}" canvas — check your math.`,
      );
    }
  }
  for (const k of ['color', 'fill', 'border'] as const) {
    if (!(k in opts)) continue;
    const v = opts[k];
    validateColorLike(method, k, v);
  }
}

function validateColorLike(method: string, key: string, value: unknown): void {
  if (typeof value === 'string') {
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error(
        `slide.${method} opts.${key}="${value}" must be a 6-digit hex string with no leading "#".`,
      );
    }
    return;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.color === 'string' && !/^[0-9a-fA-F]{6}$/.test(obj.color)) {
      throw new Error(
        `slide.${method} opts.${key}.color="${obj.color}" must be a 6-digit hex string with no leading "#".`,
      );
    }
  }
}

function validateBackground(value: unknown): void {
  if (!value || typeof value !== 'object') {
    throw new Error('slide.background must be an object like { color: "RRGGBB" }.');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.color === 'string' && !/^[0-9a-fA-F]{6}$/.test(obj.color)) {
    throw new Error(`slide.background.color must be a 6-digit hex string (got "${obj.color}").`);
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : `${v}`;
  if (typeof v === 'string') return JSON.stringify(v);
  return typeof v;
}

/** The `helpers` object passed alongside `slide` and `theme` into LLM code. */
export type SlideHelpers = ReturnType<typeof buildHelpers>;

export function buildHelpers(theme: Theme) {
  return Object.freeze({
    /** Identity — semantic clarity in slide code, e.g. `helpers.inches(0.5)`. */
    inches: (n: number) => n,
    /** Identity — point-size pass-through. */
    pt: (n: number) => n,
    lighten: (hex: string, amount: number) => lighten(hex, amount),
    darken: (hex: string, amount: number) => darken(hex, amount),
    /** Pick a readable foreground colour for the given background. */
    contrastInk: (bgHex: string) => contrastInk(bgHex, theme),
    /** Strip a leading "#" if the LLM forgot to. */
    hex: (c: string) => c.replace(/^#/, '').toUpperCase(),
  });
}
