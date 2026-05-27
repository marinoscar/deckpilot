import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { z } from 'zod';

import {
  DesignSystemSchema,
  SlidePlanSchema,
  SlidePatchSchema,
  SlideSchema,
  formatZodError,
  type DesignSystem,
  type Slide,
  type SlidePlan,
} from '../deck/schema.js';
import { applySlidePatch, summarizePlan, summarizeSlide } from '../deck/revise.js';
import { renderPlan } from '../render/renderer.js';
import { PreviewUnavailableError, isPreviewAvailable, readPng, renderSlideToPng } from '../render/preview.js';
import type { TemplateProfile } from '../template/profile.js';
import { summarizeTemplate } from '../template/profile.js';
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
  getTemplate: () => TemplateProfile | null;
  loadTemplate: (path: string) => Promise<TemplateProfile>;
  getDesignSystem: () => DesignSystem | null;
  setDesignSystem: (ds: DesignSystem) => void;
  /** Hard cap on render_slide_preview calls per slide. 0 disables the tool entirely. */
  critiquePassesPerSlide: () => number;
  /** Tracks how many render_slide_preview calls a given slide has already cost. */
  consumeCritiquePass: (slideId: string) => { remaining: number; allowed: boolean };
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
    'Partial slide fields to overwrite. The whole `body` is replaced atomically — patches cannot deep-merge into a composition.',
  ),
});

export function buildDeckTools(ctx: DeckToolContext): Tool[] {
  // `defineTool` returns Tool<TArgs> with the specific arg type inferred from
  // the zod schema; the SDK's createSession expects Tool<unknown>[] (its
  // generic is invariant). Cast each tool to `Tool` (= Tool<unknown>) at the
  // boundary.
  const tools: Tool[] = [
    defineTool('set_design_system', {
      description: [
        'Establish the deck-wide visual guideline. Call this EXACTLY ONCE per deck, BEFORE propose_outline.',
        'Pick a coherent palette (one primary accent + one supporting alt accent), a font pair, a tone',
        '(editorial / minimal / corporate / energetic / studious), and decorative habits (kickers,',
        'footer band, card style). All subsequent slides will be composed against this guideline so the',
        'deck feels designed end-to-end, not assembled. If the user gave you style hints, honour them.',
        'If they did not, default to tone="editorial", a navy + red palette, kickers on, footer band on.',
      ].join(' '),
      parameters: DesignSystemSchema,
      skipPermission: true,
      handler: async (ds): Promise<ToolResult<{ summary: string }>> => {
        const parsed = DesignSystemSchema.safeParse(ds);
        if (!parsed.success) {
          return {
            ok: false,
            error: 'DesignSystem failed validation:\n' + formatZodError(parsed.error),
          };
        }
        ctx.setDesignSystem(parsed.data);
        const d = parsed.data;
        const summary = `tone=${d.tone}, accent=#${d.accent}, accentAlt=#${d.accentAlt}, fonts=${d.fontHeading}/${d.fontBody}, cardStyle=${d.cardStyle}, kickers=${d.useKickers}`;
        return {
          ok: true,
          message: 'Design system locked. Now call propose_outline.',
          data: { summary },
        };
      },
    }) as Tool,

    defineTool('propose_outline', {
      description: [
        'Author or replace the working SlidePlan. Call AFTER set_design_system.',
        'Each slide is composed of: optional kicker (small all-caps signpost), title, subtitle,',
        'and a body composition. Body composition kinds:',
        '  prose   — kicker + title + lead paragraph + bullets (for ordinary narrative slides)',
        '  grid    — 2/3/4-column card layout (use for comparisons, progressions, KPI grids,',
        '            stage breakdowns; mix-and-match kickers, numbers, glyphs, and CTA pills per card)',
        '  steps   — horizontal row of numbered badges with titles + descriptions (for process flows)',
        '  callout — one oversized takeaway sentence (use for "bottom-line" slides)',
        '  quote   — pull quote with attribution',
        'Vary composition kinds across the deck — never use prose for every slide. ALWAYS populate',
        'speaker notes. Slide ids should be short and stable (e.g. "s1", "intro", "team-snapshot").',
      ].join(' '),
      parameters: SlidePlanSchema,
      skipPermission: true,
      handler: async (plan): Promise<ToolResult<{ summary: string }>> => {
        const parsed = SlidePlanSchema.safeParse(plan);
        if (!parsed.success) {
          return {
            ok: false,
            error: 'SlidePlan failed validation:\n' + formatZodError(parsed.error),
            hint: 'Adjust the offending fields and resend propose_outline with the corrected plan.',
          };
        }
        ctx.setPlan(parsed.data);
        // Keep the session-level design system in sync with what's in the plan.
        ctx.setDesignSystem(parsed.data.design);
        return {
          ok: true,
          message: `Outline accepted (${parsed.data.slides.length} slides). Refine with revise_slide; write with render_deck or save_deck.`,
          data: { summary: summarizePlan(parsed.data) },
        };
      },
    }) as Tool,

    defineTool('revise_slide', {
      description: [
        'Patch a single slide in the working plan. Only include fields you want to change.',
        'The body field is atomic — to change composition kind, send a complete new body object.',
        'If you want to change the deck-wide design system, do NOT use this; call set_design_system.',
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
            hint: 'Verify the slide id and that the patched fields are valid.',
          };
        }
      },
    }) as Tool,

    defineTool('render_deck', {
      description:
        "Render the current SlidePlan to a .pptx on disk. Returns the absolute path. Call this when the user signals they're happy with the outline (or earlier if they ask for a draft).",
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
          const abs = await renderPlan(plan, out, { template: ctx.getTemplate() ?? undefined });
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
          const abs = await renderPlan(plan, out, { template: ctx.getTemplate() ?? undefined });
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

    defineTool('inspect_template', {
      description:
        'Load a `.pptx` whose theme (accent colour, fonts) should be inherited by subsequent renders. The slides in the template file are NOT imported — only its visual style. Returns a one-paragraph summary of what was extracted so you can confirm or react to it.',
      parameters: z.object({
        path: z
          .string()
          .min(1)
          .max(512)
          .describe('Path (relative to cwd or absolute) to a .pptx file to use as a style template.'),
      }),
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ summary: string }>> => {
        try {
          const profile = await ctx.loadTemplate(args.path);
          return {
            ok: true,
            message: `Template loaded: ${profile.sourcePath}`,
            data: { summary: summarizeTemplate(profile) },
          };
        } catch (e) {
          return {
            ok: false,
            error: `Template load failed: ${(e as Error).message}`,
            hint: 'Verify the path is a valid .pptx file.',
          };
        }
      },
    }) as Tool,

    defineTool('render_slide_preview', {
      description: [
        'Render the current state of one slide to a PNG image attached to the tool',
        'result so YOU can see how it actually looks. Call this after each',
        'propose_outline or revise_slide where you want to verify the visual.',
        'Evaluate: type hierarchy clear? grid columns balanced? colour story',
        'cohesive? CTA pills consistent across siblings? Is the slide AS GOOD AS',
        'the references the user shared? If not, call revise_slide and re-preview.',
        'There is a hard budget of N preview calls per slide (default 1, configurable',
        'via --critique-passes). When you exhaust it, accept the slide and move on.',
      ].join(' '),
      parameters: z.object({
        slideId: z
          .string()
          .min(1)
          .max(32)
          .describe('The id of the slide to preview. See propose_outline output.'),
      }),
      skipPermission: true,
      handler: async (args, _invocation) => {
        // Budget check
        const passes = ctx.critiquePassesPerSlide();
        if (passes <= 0) {
          return {
            textResultForLlm:
              'Visual critique is disabled (--critique-passes 0). Skip preview and proceed with the current draft.',
            resultType: 'failure' as const,
            error: 'critique_disabled',
          };
        }
        const allow = ctx.consumeCritiquePass(args.slideId);
        if (!allow.allowed) {
          return {
            textResultForLlm: `Critique budget for slide "${args.slideId}" is exhausted (${passes} passes already consumed). Accept the slide as-is and move to the next one. If genuine issues remain, summarise them in chat for the user to weigh in.`,
            resultType: 'failure' as const,
            error: 'budget_exhausted',
          };
        }

        const plan = ctx.getPlan();
        if (!plan) {
          return {
            textResultForLlm: 'No plan to preview. Call propose_outline first.',
            resultType: 'failure' as const,
            error: 'no_plan',
          };
        }

        if (!(await isPreviewAvailable())) {
          return {
            textResultForLlm:
              'Visual preview is not available — LibreOffice (`soffice`) is not on $PATH. Tell the user and proceed without the visual critique. They can install it on Ubuntu/WSL with: sudo apt install libreoffice poppler-utils',
            resultType: 'failure' as const,
            error: 'libreoffice_missing',
          };
        }

        try {
          const pngPath = await renderSlideToPng(plan, args.slideId, {
            template: ctx.getTemplate() ?? undefined,
          });
          const bytes = await readPng(pngPath);
          const base64 = bytes.toString('base64');
          const slideIdx = plan.slides.findIndex((s) => s.id === args.slideId);
          const remaining = allow.remaining;
          return {
            textResultForLlm: `Rendered slide ${slideIdx + 1} ("${args.slideId}") to a PNG (attached). ${remaining} critique pass${remaining === 1 ? '' : 'es'} remaining for this slide. Look at the image; if it's not as good as the references, call revise_slide.`,
            binaryResultsForLlm: [
              {
                type: 'image' as const,
                mimeType: 'image/png',
                data: base64,
                description: `Slide ${slideIdx + 1}: ${args.slideId}`,
              },
            ],
            resultType: 'success' as const,
          };
        } catch (e) {
          if (e instanceof PreviewUnavailableError) {
            return {
              textResultForLlm: e.message,
              resultType: 'failure' as const,
              error: 'preview_unavailable',
            };
          }
          return {
            textResultForLlm: `Preview render failed: ${(e as Error).message}`,
            resultType: 'failure' as const,
            error: 'render_failed',
          };
        }
      },
    }) as Tool,
  ];
  return tools;
}
