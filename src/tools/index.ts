import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { z } from 'zod';

import {
  SlidePlanSchema,
  SlidePatchSchema,
  formatZodError,
  type SlidePlan,
  type Slide,
} from '../deck/schema.js';
import { applySlidePatch, summarizePlan, summarizeSlide } from '../deck/revise.js';
import { renderPlan } from '../render/renderer.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Surface the ChatSession exposes to deck-mutating tools. Kept narrow so we
 * don't accidentally hand the LLM the keys to the whole UI.
 */
export type DeckToolContext = {
  getPlan: () => SlidePlan | null;
  setPlan: (plan: SlidePlan) => void;
  patchSlide: (slideId: string, patch: z.infer<typeof SlidePatchSchema>) => Slide;
  defaultOutputPath: () => string;
};

type ToolResult<T = unknown> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string; hint?: string };

const RenderArgs = z.object({
  outputPath: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Path (relative to cwd or absolute) to write the .pptx to. Defaults to ./<deck-title>.pptx.'),
});

const SaveArgs = z.object({
  outputPath: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Where to write the .pptx. Defaults to ./<deck-title>.pptx.'),
  includePlanJson: z
    .boolean()
    .default(true)
    .describe('When true, also writes the validated SlidePlan as <output>.plan.json for later re-editing.'),
});

const ReviseArgs = z.object({
  slideId: z.string().min(1).describe('The id of the slide to patch (see propose_outline output).'),
  patch: SlidePatchSchema.describe(
    'Partial slide fields to overwrite. Cannot change layout. Use propose_outline to switch layouts.',
  ),
});

export function buildDeckTools(ctx: DeckToolContext): Tool[] {
  // `defineTool` returns Tool<TArgs> with the specific arg type inferred from
  // the zod schema; the SDK's createSession expects Tool<unknown>[] (its
  // generic is invariant). Cast each tool to `Tool` (= Tool<unknown>) at the
  // boundary.
  const tools: Tool[] = [
    defineTool('propose_outline', {
      description: [
        'Author or replace the working SlidePlan. ALWAYS your first move when the user asks for a deck.',
        'Pick layouts thoughtfully: title (opener), content (most slides — title + 3-6 bullets),',
        'two-col (comparisons), section (divider before a new chapter), quote (a single pull quote),',
        'closing (thanks / contact). Keep bullets concise (≤ ~80 chars), aim for 4-5 per content slide,',
        'and ALWAYS populate speaker notes. Slide ids should be short and stable (e.g. "s1", "s2").',
      ].join(' '),
      parameters: SlidePlanSchema,
      skipPermission: true,
      handler: async (plan): Promise<ToolResult<{ summary: string }>> => {
        // The SDK has already zod-validated `plan` against SlidePlanSchema
        // (because we passed the schema as `parameters`). Defensive re-validate
        // anyway to keep the renderer contract airtight.
        const parsed = SlidePlanSchema.safeParse(plan);
        if (!parsed.success) {
          return {
            ok: false,
            error: 'SlidePlan failed validation:\n' + formatZodError(parsed.error),
            hint: 'Adjust the offending fields and resend propose_outline with the corrected plan.',
          };
        }
        ctx.setPlan(parsed.data);
        return {
          ok: true,
          message: `Outline accepted (${parsed.data.slides.length} slides). Use revise_slide to refine individual slides, then render_deck to write the .pptx.`,
          data: { summary: summarizePlan(parsed.data) },
        };
      },
    }) as Tool,

    defineTool('revise_slide', {
      description: [
        'Patch a single slide in the working plan. Only include fields you want to change.',
        'Cannot change a slide\'s `layout` — to do that, call propose_outline with the whole plan again.',
      ].join(' '),
      parameters: ReviseArgs,
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ slide: string }>> => {
        if (!ctx.getPlan()) {
          return {
            ok: false,
            error: 'No working plan yet.',
            hint: 'Call propose_outline first.',
          };
        }
        try {
          const slide = ctx.patchSlide(args.slideId, args.patch);
          return {
            ok: true,
            message: `Patched slide ${args.slideId}.`,
            data: { slide: summarizeSlide(slide) },
          };
        } catch (e) {
          return {
            ok: false,
            error: (e as Error).message,
            hint: 'Verify the slide id, and that the patched fields are valid for that slide\'s layout.',
          };
        }
      },
    }) as Tool,

    defineTool('render_deck', {
      description:
        'Render the current SlidePlan to a .pptx on disk. Returns the absolute path. Call this when the user signals they\'re happy with the outline (or earlier if they ask for a draft).',
      parameters: RenderArgs,
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ path: string; slides: number }>> => {
        const plan = ctx.getPlan();
        if (!plan) {
          return {
            ok: false,
            error: 'No plan to render.',
            hint: 'Call propose_outline first.',
          };
        }
        const out = args.outputPath ?? ctx.defaultOutputPath();
        try {
          const abs = await renderPlan(plan, out);
          return {
            ok: true,
            message: `Wrote ${plan.slides.length}-slide deck to ${abs}.`,
            data: { path: abs, slides: plan.slides.length },
          };
        } catch (e) {
          return { ok: false, error: `Render failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,

    defineTool('save_deck', {
      description:
        'Render the current SlidePlan to .pptx AND (by default) save the plan.json next to it for later re-editing.',
      parameters: SaveArgs,
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ pptx: string; planJson?: string }>> => {
        const plan = ctx.getPlan();
        if (!plan) {
          return {
            ok: false,
            error: 'No plan to save.',
            hint: 'Call propose_outline first.',
          };
        }
        const out = args.outputPath ?? ctx.defaultOutputPath();
        try {
          const abs = await renderPlan(plan, out);
          const data: { pptx: string; planJson?: string } = { pptx: abs };
          if (args.includePlanJson) {
            const jsonPath = resolve(
              dirname(abs),
              (abs.replace(/\.pptx$/i, '') || abs) + '.plan.json',
            );
            await mkdir(dirname(jsonPath), { recursive: true });
            await writeFile(jsonPath, JSON.stringify(plan, null, 2));
            data.planJson = jsonPath;
          }
          return {
            ok: true,
            message: `Saved deck to ${abs}${data.planJson ? ` (and plan to ${data.planJson})` : ''}.`,
            data,
          };
        } catch (e) {
          return { ok: false, error: `Save failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,
  ];
  return tools;
}
