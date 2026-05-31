/**
 * Sandbox runner for LLM-generated slide code.
 *
 * The LLM emits the body of a `render(slide, theme, helpers)` function. We
 * wrap it in a tiny launcher, drop it into a `vm.Context` whose globals are
 * just the proxy / theme / helpers, and execute. The proxy in slide-api.ts
 * enforces the API surface; this module enforces execution safety:
 *
 *   - no `require`, no `import`, no fs / net access (none in scope)
 *   - no dynamic code-gen (`codeGeneration.strings: false`)
 *   - hard timeout per slide
 *   - exceptions surface up with a descriptive message for the LLM
 *
 * The runner does NOT build the pptxgenjs slide itself — the caller threads
 * an existing slide in. That keeps slide allocation in the renderer where it
 * also handles the parent pptx and ordering.
 */
import vm from 'node:vm';
import type { Theme } from '../deck/theme.js';
import { type PSlide, buildHelpers, buildSlideProxy } from './slide-api.js';

export class SlideCodeError extends Error {
  constructor(
    message: string,
    public readonly slideId: string,
    public readonly cause?: Error,
  ) {
    super(`Slide "${slideId}" render code threw: ${message}`);
    this.name = 'SlideCodeError';
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Execute the LLM's slide code against an already-allocated pptxgenjs slide.
 * The code may be either:
 *   1. A function declaration `function render(slide, theme, helpers) { ... }`
 *   2. Bare statements that use `slide`, `theme`, `helpers` directly
 *
 * In both cases we wrap-and-invoke so the LLM can write whichever style it
 * finds clearest.
 */
/** Absolute brand-asset paths exposed to slide code as `theme.assets`. */
export type ThemeAssets = { logo?: string; wordmark?: string; background?: string };

export function runSlideCode(
  code: string,
  pptxSlide: PSlide,
  theme: Theme,
  slideId: string,
  opts: { timeoutMs?: number; assets?: ThemeAssets } = {},
): void {
  const proxy = buildSlideProxy(pptxSlide, theme);
  const helpers = buildHelpers(theme);
  const sandbox = {
    slide: proxy,
    theme: Object.freeze({ ...theme, ...(opts.assets ? { assets: opts.assets } : {}) }),
    helpers,
    // Pass-through console so an LLM that drops `console.log` for debugging
    // doesn't crash. We deliberately drop the output on the floor — diagnostic
    // info should flow through tool-result text, not stdout.
    console: Object.freeze({
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
    }),
  };

  const ctx = vm.createContext(sandbox, {
    name: `slide-${slideId}`,
    codeGeneration: { strings: false, wasm: false },
  });

  const wrapped = `
    "use strict";
    (function __deckpilot_run__() {
      ${code}
      if (typeof render === 'function') {
        render(slide, theme, helpers);
      }
    })();
  `;

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const script = new vm.Script(wrapped, { filename: `slide-${slideId}.js` });
    script.runInContext(ctx, { timeout, breakOnSigint: true });
  } catch (e) {
    const err = e as Error;
    throw new SlideCodeError(err.message ?? String(err), slideId, err);
  }
}
