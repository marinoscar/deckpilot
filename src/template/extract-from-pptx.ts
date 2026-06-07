/**
 * Vision-driven brand extraction. Spawns a headless Copilot session and
 * has the LLM author a rich TemplateSpec by looking at the rendered
 * slides of a source .pptx.
 *
 *   1. Validate inputs / preview-renderer availability.
 *   2. Boot a fresh DeckPilotClient (no project, no chat UI).
 *   3. Register the extraction tools (`study_pptx_slides`, `save_template`).
 *   4. session.sendAndWait("study … then save_template …") — the LLM
 *      drives the rest.
 *   5. Watch for the save callback; on success, disconnect + return path.
 *
 * Falls back to `templateFromPptx` (OOXML-only) when the renderer is unavailable.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '../copilot/client.js';
import { isPreviewAvailable } from '../render/pptx-to-pngs.js';
import { templateDir } from '../store/paths.js';
import { saveTemplate as saveNamedTemplate } from '../store/templates.js';
import { buildExtractTools } from '../tools/extract.js';
import { EXTRACT_SYSTEM_PROMPT } from './extract-prompt.js';
import { templateFromPptx } from './from-pptx.js';
import type { TemplateSpec } from './spec.js';

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export type ExtractFromPptxOptions = {
  name: string;
  pptxPath: string;
  brand?: string;
  description?: string;
  overwrite?: boolean;
  /** Max slides shown to the model. Default 20. */
  maxSlides?: number;
  /** Override LLM model. Falls through to Copilot CLI default if unset. */
  model?: string;
  /** Optional Copilot GitHub token (otherwise inherits from env/keychain). */
  token?: string;
  /** Overall session timeout in ms. Default 120_000. */
  timeoutMs?: number;
  /** Progress hook for the CLI to print status lines. */
  onProgress?: (event: ExtractEvent) => void;
};

export type ExtractEvent =
  | { kind: 'preview'; available: boolean }
  | { kind: 'session-started'; model?: string }
  | { kind: 'tool-start'; name: string }
  | { kind: 'tool-complete'; name: string; ok: boolean }
  | { kind: 'saved'; path: string }
  | { kind: 'fallback'; reason: string };

export type ExtractResult = {
  /** Absolute path to the saved template directory. */
  savedPath: string;
  /** True when the deep vision flow ran; false when fell back to shallow. */
  vision: boolean;
};

/**
 * Run the vision-driven extraction. On any non-recoverable failure (no
 * preview renderer, no auth, timeout, model never calls save_template), falls
 * back to the OOXML-only `templateFromPptx` path so the CLI always
 * produces a template the user can iterate on.
 */
export async function extractTemplateFromPptx(
  opts: ExtractFromPptxOptions,
): Promise<ExtractResult> {
  const absPptx = resolve(process.cwd(), opts.pptxPath);
  if (!existsSync(absPptx)) {
    throw new ExtractionError(`No such file: ${opts.pptxPath}`);
  }

  const previewOk = await isPreviewAvailable();
  opts.onProgress?.({ kind: 'preview', available: previewOk });
  if (!previewOk) {
    return shallowFallback(opts, 'pptx-glimpse renderer unavailable');
  }

  // v0.16: pre-extract OOXML BEFORE booting the LLM session. The master,
  // paletteSamples, and donor geometry positions come from this; the LLM's
  // job in the session is the creative fields (voice/copy/guidance) plus
  // per-donor summaries.
  let preExtracted: TemplateSpec | undefined;
  try {
    preExtracted = await templateFromPptx(opts.name, opts.pptxPath, {
      brand: opts.brand,
      description: opts.description,
      templateRootDir: templateDir(opts.name),
    });
  } catch (e) {
    // Pre-extraction failure is non-fatal — the LLM session can still author
    // a spec from images alone. Log via the fallback signal.
    opts.onProgress?.({
      kind: 'fallback',
      reason: `OOXML pre-extraction failed; vision session will run without it: ${(e as Error).message}`,
    });
    preExtracted = undefined;
  }

  let savedDir: string | null = null;

  const tools = buildExtractTools({
    templateName: opts.name,
    pptxPath: absPptx,
    overwrite: opts.overwrite ?? false,
    maxSlides: opts.maxSlides ?? 20,
    preExtracted,
    onSaved: (dir) => {
      savedDir = dir;
      opts.onProgress?.({ kind: 'saved', path: dir });
    },
  });

  const dp = createClient({ gitHubToken: opts.token });
  await dp.start();

  let session: Awaited<ReturnType<typeof dp.createSession>>;
  try {
    session = await dp.createSession({
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      tools,
      model: opts.model,
      streaming: false,
    });
  } catch (e) {
    await dp.stop();
    // Auth / connectivity issues collapse to shallow.
    return shallowFallback(opts, `Could not start Copilot session: ${(e as Error).message}`);
  }

  opts.onProgress?.({ kind: 'session-started', model: opts.model });

  // Surface tool lifecycle to the CLI so the user sees activity.
  session.on('tool.execution_start', (event) => {
    const data = event.data as { toolName?: string };
    if (data.toolName) opts.onProgress?.({ kind: 'tool-start', name: data.toolName });
  });
  session.on('tool.execution_complete', (event) => {
    const data = event.data as { toolName?: string; resultType?: string };
    if (data.toolName) {
      opts.onProgress?.({
        kind: 'tool-complete',
        name: data.toolName,
        ok: data.resultType !== 'failure',
      });
    }
  });

  const seedPrompt = buildSeedPrompt(opts);
  const timeoutMs = opts.timeoutMs ?? 120_000;

  try {
    await session.sendAndWait(seedPrompt, timeoutMs);
  } catch (e) {
    try {
      await session.disconnect();
    } catch {
      /* already torn down */
    }
    await dp.stop();
    return shallowFallback(opts, `Extraction session failed: ${(e as Error).message}`);
  }

  try {
    await session.disconnect();
  } catch {
    /* ignore */
  }
  await dp.stop();

  if (!savedDir) {
    return shallowFallback(opts, 'Model did not call save_template within the timeout');
  }
  return { savedPath: savedDir, vision: true };
}

function buildSeedPrompt(opts: ExtractFromPptxOptions): string {
  const hints: string[] = [];
  if (opts.brand) hints.push(`The user-provided brand name is "${opts.brand}".`);
  if (opts.description) hints.push(`Description hint: "${opts.description}".`);
  const hintLine = hints.length ? `\n\n${hints.join(' ')}` : '';
  return [
    `Extract a TemplateSpec from the slides at "${opts.pptxPath}".`,
    `The template MUST be named "${opts.name}".`,
    'Call study_pptx_slides first, then save_template once with a complete spec.',
    `${hintLine}`,
  ].join('\n');
}

/** OOXML-only fallback. Writes the same TemplateSpec shape but with empty
 * voice/copy/guidance — the user can fill those in by hand. */
async function shallowFallback(
  opts: ExtractFromPptxOptions,
  reason: string,
): Promise<ExtractResult> {
  opts.onProgress?.({ kind: 'fallback', reason });
  const spec = await templateFromPptx(opts.name, opts.pptxPath, {
    brand: opts.brand,
    description: opts.description,
    templateRootDir: templateDir(opts.name),
  });
  const { rootDir } = await saveNamedTemplate(spec, { overwrite: opts.overwrite ?? false });
  return { savedPath: rootDir, vision: false };
}
