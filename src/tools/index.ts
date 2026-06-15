import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { z } from 'zod';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pptxgenjsImport from 'pptxgenjs';
import { type DeckBrief, DeckBriefSchema, formatZodError, summarizeBrief } from '../deck/brief.js';
import type { Theme } from '../deck/theme.js';
import {
  PreviewUnavailableError,
  isPreviewAvailable,
  readPng,
  renderSlideToPng,
} from '../render/preview.js';
import { SlideCodeError, renderDeck } from '../render/renderer.js';
import { runSlideCode } from '../render/sandbox.js';
import { type SkillStage, SkillStageSchema } from '../skill/spec.js';
import {
  TemplateNotFoundError as NamedTemplateNotFoundError,
  listTemplates as listNamedTemplates,
  saveTemplate as saveNamedTemplate,
} from '../store/templates.js';
import { templateFromPptx } from '../template/from-pptx.js';
import type { TemplateProfile } from '../template/profile.js';
import { summarizeTemplate } from '../template/profile.js';
import {
  TemplateSpecSchema,
  formatZodError as formatTemplateError,
  summarizeTemplate as summarizeTemplateSpec,
} from '../template/spec.js';
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported constructor type
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

/**
 * Surface the ChatSession exposes to deck-mutating tools. Kept narrow so we
 * don't accidentally hand the LLM the keys to the whole UI.
 */
export type DeckToolContext = {
  getBrief: () => DeckBrief | null;
  setBrief: (brief: DeckBrief) => void;
  getSlideCode: (slideId: string) => string | null;
  setSlideCode: (slideId: string, code: string) => void;
  getAllSlideCode: () => ReadonlyMap<string, string>;
  defaultOutputPath: () => string;
  getTemplate: () => TemplateProfile | null;
  loadTemplate: (path: string) => Promise<TemplateProfile>;
  /** Apply a named template from ~/.deckpilot/templates/ to the active session. */
  useNamedTemplate: (name: string) => Promise<void>;
  /** Active named template, if any. */
  getActiveTemplateName: () => string | undefined;
  /** Active skill name, if any. */
  getActiveSkillName: () => string | undefined;
  /** Active skill's instructions for a given stage, or null if absent. */
  getSkillStage: (stage: SkillStage) => string | null;
  /** Hard cap on critique/preview calls per slide. 0 disables visual critique. */
  critiquePassesPerSlide: () => number;
  consumeCritiquePass: (slideId: string) => { remaining: number; allowed: boolean };
  /**
   * Whether previews have been disabled for the rest of this session after an
   * infrastructure-level render failure. Set the first time the rasteriser
   * throws so we don't re-run the (slow) failing pipeline on every slide. The
   * stored string is the underlying failure reason (or null when previews work).
   */
  previewFailureReason: () => string | null;
  notePreviewUnavailable: (reason: string) => void;
  /**
   * Copy a rendered preview PNG into the project (or tmpdir in ephemeral
   * mode) and push a `preview` transcript entry so the user sees a
   * clickable file:// link. Returns the saved absolute path.
   */
  recordPreview: (
    slideId: string,
    sourcePath: string,
  ) => Promise<{ pngPath: string; pass: number }>;
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
    .describe(
      'Path (relative to cwd or absolute) to write the .pptx to. Defaults to ./<deck-title>.pptx.',
    ),
});

const SaveArgs = z.object({
  outputPath: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Where to write the .pptx. Defaults to ./<deck-title>.pptx.'),
  includeSources: z
    .boolean()
    .default(false)
    .describe(
      "When true, also writes <output>.brief.json and one <output>.<slideId>.slide.ts file per slide next to the .pptx. OFF by default — the brief and slide sources are already autosaved inside the persistent project directory under ~/.deckpilot/projects/<slug>/, so writing them next to the .pptx would just clutter the user's working directory. Only set true if the user explicitly asks for sidecar source files.",
    ),
});

const WriteSlideCodeArgs = z.object({
  slideId: z
    .string()
    .min(1)
    .max(32)
    .describe('The id of the slide to author (must exist in the brief).'),
  code: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'JavaScript/TypeScript that draws this slide. May be either (a) a function declaration `function render(slide, theme, helpers) { ... }`, or (b) bare statements that call slide methods directly. See the system prompt for the API surface.',
    ),
});

/**
 * Guidance returned when the PNG preview can't be produced for infrastructure
 * reasons (the rasteriser threw). Frames it as an environment issue, not a
 * code defect, so the model keeps building blind instead of thrashing on the
 * slide or giving up. Used both at first failure and on the per-session
 * short-circuit for subsequent slides.
 */
function previewUnavailableGuidance(reason: string): string {
  return `The visual preview is unavailable in this environment (${reason}). This is an infrastructure issue, not a problem with your slide code — keep building the remaining slides without previews and call save_deck / render_deck at the end. Further preview attempts this session are skipped to avoid repeating the failure.`;
}

export function buildDeckTools(ctx: DeckToolContext): Tool[] {
  // `defineTool` returns Tool<TArgs>; the SDK's createSession expects
  // Tool<unknown>[] (its generic is invariant). Cast each tool to `Tool` at
  // the boundary.
  const tools: Tool[] = [
    defineTool('propose_deck_brief', {
      description: [
        'PHASE 1. Author or replace the working DeckBrief. This is the outline the user approves before any slide code is written.',
        'A brief has: meta (title, subtitle?, author?, audience?), theme (palette + fonts + tone hint + aspect), and slides (each with id, title, purpose, an optional role, and optional notes).',
        'Set each slide\'s role: "cover" for the opening/title slide, "divider" for section breaks, "content" for body slides. It drives which brand background a template applies (cover/divider get the cover background; content gets the content background).',
        "Choose the theme yourself — DeckPilot does NOT use presets. Invent a coherent palette (accent + complementary accentAlt, ink, muted, paper) and font pair that fits the user's ask. If a DECKPILOT.md style guide was loaded, honour it.",
        'After this tool succeeds, present the outline to the user as readable prose and wait for approval. Do not start writing slide code until the user says go/build/proceed.',
      ].join(' '),
      parameters: DeckBriefSchema,
      skipPermission: true,
      handler: async (brief): Promise<ToolResult<{ summary: string }>> => {
        const parsed = DeckBriefSchema.safeParse(brief);
        if (!parsed.success) {
          return {
            ok: false,
            error: `DeckBrief failed validation:\n${formatZodError(parsed.error)}`,
            hint: 'Adjust the offending fields and resend.',
          };
        }
        ctx.setBrief(parsed.data);
        return {
          ok: true,
          message: `Brief accepted (${parsed.data.slides.length} slides). Present it to the user and wait for approval before writing slide code.`,
          data: { summary: summarizeBrief(parsed.data) },
        };
      },
    }) as Tool,

    defineTool('write_slide_code', {
      description: [
        'PHASE 2. Write (or replace) the rendering code for ONE slide and immediately render a PNG of the result for visual critique.',
        'The code receives three globals: `slide` (the pptxgenjs slide proxy), `theme` (your accepted DeckBrief theme), and `helpers` (lighten/darken/contrastInk/hex). See the system prompt for the full API surface.',
        'On the FIRST preview of any slide you MUST find at least one specific improvement — assume the first draft is never perfect. Call write_slide_code again with a revised function.',
        'Hard cap: critique-passes per slide (default 3, max 5). Each call to this tool counts as one pass.',
        'When the slide looks genuinely great, stop and move to the next slide.',
      ].join(' '),
      parameters: WriteSlideCodeArgs,
      skipPermission: true,
      handler: async (args, _invocation) => {
        const brief = ctx.getBrief();
        if (!brief) {
          return {
            textResultForLlm:
              'No working brief yet. Call propose_deck_brief first and get user approval.',
            resultType: 'failure' as const,
            error: 'no_brief',
          };
        }
        if (!brief.slides.some((s) => s.id === args.slideId)) {
          return {
            textResultForLlm: `No slide with id "${args.slideId}" in the brief. Valid ids: ${brief.slides.map((s) => s.id).join(', ')}`,
            resultType: 'failure' as const,
            error: 'unknown_slide_id',
          };
        }

        // Dry-run the code against a throwaway slide to surface syntax / API
        // errors before we commit it to the session. This lets us reject bad
        // code without polluting the working state.
        try {
          const probe = new PptxGenJS();
          probe.layout = brief.theme.aspect === '4:3' ? 'LAYOUT_STANDARD' : 'LAYOUT_WIDE';
          const dummy = probe.addSlide();
          runSlideCode(args.code, dummy, brief.theme, args.slideId);
        } catch (e) {
          const msg = e instanceof SlideCodeError ? e.message : (e as Error).message;
          return {
            textResultForLlm: `Slide code didn't execute cleanly — fix and resend.\n\n${msg}`,
            resultType: 'failure' as const,
            error: 'slide_code_error',
          };
        }

        // Commit to the session before previewing — that way revising via
        // another write_slide_code call always sees the latest state.
        ctx.setSlideCode(args.slideId, args.code);

        // If a previous slide already proved the rasteriser is broken in this
        // environment, short-circuit before consuming a critique pass or
        // re-running the (slow) failing pipeline.
        const priorFailure = ctx.previewFailureReason();
        if (priorFailure) {
          return {
            textResultForLlm: `Slide code stored for "${args.slideId}". ${previewUnavailableGuidance(priorFailure)}`,
            resultType: 'success' as const,
          };
        }

        // Critique budget check — also gates whether we run the preview.
        const passes = ctx.critiquePassesPerSlide();
        if (passes <= 0) {
          return {
            textResultForLlm: `Slide code stored for "${args.slideId}". Visual critique is disabled (--critique-passes 0); skipping preview. Proceed to the next slide.`,
            resultType: 'success' as const,
          };
        }
        const allow = ctx.consumeCritiquePass(args.slideId);
        if (!allow.allowed) {
          return {
            textResultForLlm: `Slide code stored for "${args.slideId}", but the per-slide critique budget (${passes} passes) is already exhausted — no fresh preview emitted. Accept the slide as it is or summarise concerns in chat for the user.`,
            resultType: 'success' as const,
          };
        }

        if (!(await isPreviewAvailable())) {
          return {
            textResultForLlm: `Slide code stored for "${args.slideId}". Visual preview unavailable (pptx-glimpse renderer not loadable). Proceed without the PNG — tell the user to reinstall dependencies with \`npm install\`.`,
            resultType: 'success' as const,
          };
        }

        try {
          const pngPath = await renderSlideToPng(brief, ctx.getAllSlideCode(), args.slideId, {
            template: ctx.getTemplate() ?? undefined,
          });
          const bytes = await readPng(pngPath);
          const base64 = bytes.toString('base64');
          const slideIdx = brief.slides.findIndex((s) => s.id === args.slideId);
          const remaining = allow.remaining;
          // Persist the PNG into the project + surface a clickable link to the user.
          const recorded = await ctx.recordPreview(args.slideId, pngPath);
          return {
            textResultForLlm: `Slide ${slideIdx + 1} ("${args.slideId}") code stored and rendered to PNG (attached). User-visible copy at ${recorded.pngPath}. ${remaining} critique pass${remaining === 1 ? '' : 'es'} remaining. Look at the image; on the FIRST pass for any slide, find at least one specific improvement and call write_slide_code again with revised code. Stop when the slide is genuinely great, not just acceptable.`,
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
            ctx.notePreviewUnavailable(e.message);
            return {
              textResultForLlm: `Slide code stored for "${args.slideId}". ${previewUnavailableGuidance(e.message)}`,
              resultType: 'success' as const,
            };
          }
          if (e instanceof SlideCodeError) {
            return {
              textResultForLlm: `Slide code stored but threw during real render: ${e.message}. Fix and resend.`,
              resultType: 'failure' as const,
              error: 'slide_code_error',
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

    defineTool('preview_slide', {
      description: [
        'PHASE 3 (and rare ad-hoc Phase 2). Re-render a slide PNG without changing its code. Use this for the final cross-slide consistency review once every slide has been built.',
        'Each call counts against the per-slide critique budget. If you want to revise the slide, call write_slide_code instead.',
      ].join(' '),
      parameters: z.object({
        slideId: z.string().min(1).max(32).describe('The id of the slide to preview.'),
      }),
      skipPermission: true,
      handler: async (args, _invocation) => {
        const brief = ctx.getBrief();
        if (!brief) {
          return {
            textResultForLlm: 'No working brief. Call propose_deck_brief first.',
            resultType: 'failure' as const,
            error: 'no_brief',
          };
        }
        if (!brief.slides.some((s) => s.id === args.slideId)) {
          return {
            textResultForLlm: `No slide with id "${args.slideId}". Valid ids: ${brief.slides.map((s) => s.id).join(', ')}`,
            resultType: 'failure' as const,
            error: 'unknown_slide_id',
          };
        }
        const code = ctx.getSlideCode(args.slideId);
        if (!code) {
          return {
            textResultForLlm: `Slide "${args.slideId}" has no code yet. Write it with write_slide_code first.`,
            resultType: 'failure' as const,
            error: 'no_slide_code',
          };
        }

        const priorFailure = ctx.previewFailureReason();
        if (priorFailure) {
          return {
            textResultForLlm: previewUnavailableGuidance(priorFailure),
            resultType: 'failure' as const,
            error: 'preview_unavailable',
          };
        }

        const passes = ctx.critiquePassesPerSlide();
        if (passes <= 0) {
          return {
            textResultForLlm:
              'Visual critique is disabled (--critique-passes 0). Skip preview and proceed.',
            resultType: 'failure' as const,
            error: 'critique_disabled',
          };
        }
        const allow = ctx.consumeCritiquePass(args.slideId);
        if (!allow.allowed) {
          return {
            textResultForLlm: `Critique budget for slide "${args.slideId}" is exhausted (${passes} passes). Accept the slide as-is and move on.`,
            resultType: 'failure' as const,
            error: 'budget_exhausted',
          };
        }

        if (!(await isPreviewAvailable())) {
          return {
            textResultForLlm:
              'Visual preview is not available — the pptx-glimpse renderer failed to load. Tell the user to reinstall dependencies (`npm install`) and proceed without the visual critique.',
            resultType: 'failure' as const,
            error: 'preview_unavailable',
          };
        }

        try {
          const pngPath = await renderSlideToPng(brief, ctx.getAllSlideCode(), args.slideId, {
            template: ctx.getTemplate() ?? undefined,
          });
          const bytes = await readPng(pngPath);
          const base64 = bytes.toString('base64');
          const slideIdx = brief.slides.findIndex((s) => s.id === args.slideId);
          const remaining = allow.remaining;
          const recorded = await ctx.recordPreview(args.slideId, pngPath);
          return {
            textResultForLlm: `Slide ${slideIdx + 1} ("${args.slideId}") re-previewed. User-visible copy at ${recorded.pngPath}. ${remaining} pass${remaining === 1 ? '' : 'es'} remaining. Compare against sibling slides for cross-slide consistency.`,
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
            ctx.notePreviewUnavailable(e.message);
            return {
              textResultForLlm: previewUnavailableGuidance(e.message),
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

    defineTool('render_deck', {
      description:
        "Render the current DeckBrief + slide code to a .pptx on disk. Returns the absolute path. Call this when the user signals they're happy with the deck (typically after Phase 3).",
      parameters: RenderArgs,
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ path: string; slides: number }>> => {
        const brief = ctx.getBrief();
        if (!brief) {
          return {
            ok: false,
            error: 'No brief to render.',
            hint: 'Call propose_deck_brief first.',
          };
        }
        const out = args.outputPath ?? ctx.defaultOutputPath();
        try {
          const abs = await renderDeck(brief, ctx.getAllSlideCode(), out, {
            template: ctx.getTemplate() ?? undefined,
          });
          return {
            ok: true,
            message: `Wrote ${brief.slides.length}-slide deck to ${abs}.`,
            data: { path: abs, slides: brief.slides.length },
          };
        } catch (e) {
          if (e instanceof SlideCodeError) {
            return {
              ok: false,
              error: `Slide "${e.slideId}" code threw during render: ${e.message}`,
              hint: 'Fix the offending slide with write_slide_code, then retry.',
            };
          }
          return { ok: false, error: `Render failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,

    defineTool('save_deck', {
      description:
        "Render the current DeckBrief + slide code to a single .pptx at the requested path (defaults to ./<title>.pptx). Only the .pptx is written to the user's working directory — the brief and per-slide TypeScript sources are always autosaved inside the persistent project directory (~/.deckpilot/projects/<slug>/) so the deck can be resumed or re-rendered later. Set includeSources: true only if the user explicitly asks for sidecar brief.json + slide.ts files next to the .pptx.",
      parameters: SaveArgs,
      skipPermission: true,
      handler: async (
        args,
      ): Promise<ToolResult<{ pptx: string; brief?: string; slides?: string[] }>> => {
        const brief = ctx.getBrief();
        if (!brief) {
          return {
            ok: false,
            error: 'No brief to save.',
            hint: 'Call propose_deck_brief first.',
          };
        }
        const out = args.outputPath ?? ctx.defaultOutputPath();
        try {
          const abs = await renderDeck(brief, ctx.getAllSlideCode(), out, {
            template: ctx.getTemplate() ?? undefined,
          });
          const data: { pptx: string; brief?: string; slides?: string[] } = { pptx: abs };
          if (args.includeSources) {
            const base = abs.replace(/\.pptx$/i, '');
            const briefPath = `${base}.brief.json`;
            await mkdir(dirname(briefPath), { recursive: true });
            await writeFile(briefPath, JSON.stringify(brief, null, 2));
            data.brief = briefPath;
            const slidePaths: string[] = [];
            for (const slide of brief.slides) {
              const code = ctx.getSlideCode(slide.id);
              if (!code) continue;
              const sp = `${base}.${slide.id}.slide.ts`;
              await writeFile(sp, code);
              slidePaths.push(sp);
            }
            data.slides = slidePaths;
          }
          return {
            ok: true,
            message: `Saved deck to ${abs}${data.brief ? ` (+ ${data.brief}` : ''}${data.slides ? ` + ${data.slides.length} slide source files)` : ''}.`,
            data,
          };
        } catch (e) {
          if (e instanceof SlideCodeError) {
            return {
              ok: false,
              error: `Slide "${e.slideId}" code threw during save: ${e.message}`,
              hint: 'Fix with write_slide_code, then retry.',
            };
          }
          return { ok: false, error: `Save failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,

    defineTool('inspect_template', {
      description:
        'Load a `.pptx` whose theme (accent colour, fonts) should be inherited by subsequent renders ONE-SHOT (not saved as a template). The slides in the template file are NOT imported — only its visual style. Use `import_template_from_pptx` instead if the user wants a reusable named template.',
      parameters: z.object({
        path: z
          .string()
          .min(1)
          .max(512)
          .describe(
            'Path (relative to cwd or absolute) to a .pptx file to use as a style template.',
          ),
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

    defineTool('list_templates', {
      description:
        'List every named DeckPilot template saved under ~/.deckpilot/templates/. Useful when the user says "use my acme template" and you want to confirm the name first, or when offering options at the start of a deck.',
      parameters: z.object({}),
      skipPermission: true,
      handler: async (): Promise<ToolResult<{ templates: string[] }>> => {
        const list = await listNamedTemplates();
        if (list.length === 0) {
          return {
            ok: true,
            message:
              'No named templates saved yet. Suggest the user run `deckpilot template create <name>` or ask you to author one via `save_template`.',
            data: { templates: [] },
          };
        }
        const summaries = list.map((e) => summarizeTemplateSpec(e.spec));
        return {
          ok: true,
          message: summaries.join('\n'),
          data: { templates: list.map((e) => e.name) },
        };
      },
    }) as Tool,

    defineTool('use_template', {
      description:
        'Apply a saved named template (theme + optional logo + voice/copy/guidance) to the active deck. Once applied, your generated slide code receives the template`s palette as `theme` and its logo as `theme.assets.logo`; any voiceHints/copyRules/guidance are folded into your system prompt. Call this BEFORE propose_deck_brief if the user named a template up front.',
      parameters: z.object({
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9-]+$/, 'Template names are lower-case kebab.')
          .describe('Name of the template (matches the directory under ~/.deckpilot/templates/).'),
      }),
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ summary: string }>> => {
        try {
          await ctx.useNamedTemplate(args.name);
          const list = await listNamedTemplates();
          const entry = list.find((e) => e.name === args.name);
          return {
            ok: true,
            message: `Template "${args.name}" applied.`,
            data: { summary: entry ? summarizeTemplateSpec(entry.spec) : args.name },
          };
        } catch (e) {
          if (e instanceof NamedTemplateNotFoundError) {
            return {
              ok: false,
              error: e.message,
              hint: 'Call list_templates to see what names are available, or ask the user.',
            };
          }
          return {
            ok: false,
            error: `Could not use template "${args.name}": ${(e as Error).message}`,
          };
        }
      },
    }) as Tool,

    defineTool('save_template', {
      description:
        'Save a hand-authored TemplateSpec to ~/.deckpilot/templates/<name>/. Use this when the user wants you to invent a reusable template (e.g. "create a luxe black-and-gold template called luxe-jewellery"). Provide the FULL spec — palette, fonts, tone, aspect, plus any voiceHints/copyRules/guidance you want to bake in. To attach a logo file, the user must drop it into the template`s assets/ directory after creation.',
      parameters: TemplateSpecSchema,
      skipPermission: true,
      handler: async (spec): Promise<ToolResult<{ rootDir: string }>> => {
        const parsed = TemplateSpecSchema.safeParse(spec);
        if (!parsed.success) {
          return {
            ok: false,
            error: `TemplateSpec failed validation:\n${formatTemplateError(parsed.error)}`,
            hint: 'Fix the offending fields and resend.',
          };
        }
        try {
          const { rootDir } = await saveNamedTemplate(parsed.data);
          return {
            ok: true,
            message: `Saved template "${parsed.data.name}" to ${rootDir}. The user can drop logos into ${rootDir}/assets/ and rerun use_template.`,
            data: { rootDir },
          };
        } catch (e) {
          return { ok: false, error: `Save failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,

    defineTool('import_template_from_pptx', {
      description:
        'Extract palette + fonts + aspect from a `.pptx` and save the result as a NAMED template under ~/.deckpilot/templates/<name>/. Use when the user wants a reusable template seeded from an existing deck (vs `inspect_template`, which only borrows the theme for the current session). Logos / voice / brand metadata are left empty for the user to fill in afterwards.',
      parameters: z.object({
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9-]+$/, 'Template names are lower-case kebab.')
          .describe('Name for the new template (becomes the directory name).'),
        pptxPath: z
          .string()
          .min(1)
          .max(512)
          .describe('Path (relative to cwd or absolute) to a .pptx whose theme to import.'),
        brand: z.string().min(1).max(160).optional(),
        description: z.string().min(1).max(160).optional(),
      }),
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ rootDir: string }>> => {
        try {
          const spec = await templateFromPptx(args.name, args.pptxPath, {
            brand: args.brand,
            description: args.description,
          });
          const { rootDir } = await saveNamedTemplate(spec);
          return {
            ok: true,
            message: `Imported "${args.pptxPath}" → template "${args.name}" at ${rootDir}. Tell the user they can edit ${rootDir}/template.json to add voice/copy guidance and drop logos into ${rootDir}/assets/.`,
            data: { rootDir },
          };
        } catch (e) {
          return { ok: false, error: `Import failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,

    defineTool('load_skill_stage', {
      description:
        'Fetch the active skill\'s instructions for a workflow stage. Call load_skill_stage("slide-check") ONCE when you begin Phase 2 (BUILD) and apply the returned checklist to every slide before accepting it; call load_skill_stage("final-review") when you begin Phase 3 (FINAL REVIEW) and apply it before save_deck. The intake stage (Phase 1) is already in your system prompt — you do not need to load it. Returns an error if no skill is active or the skill does not provide that stage.',
      parameters: z.object({
        stage: SkillStageSchema.describe(
          'Which stage to load: "slide-check" (per-slide, Phase 2) or "final-review" (whole deck, Phase 3). "intake" is already injected.',
        ),
      }),
      skipPermission: true,
      handler: async (args): Promise<ToolResult<{ stage: SkillStage; instructions: string }>> => {
        const skillName = ctx.getActiveSkillName();
        if (!skillName) {
          return {
            ok: false,
            error: 'No skill is active for this deck, so there are no staged instructions to load.',
            hint: 'Proceed without skill instructions.',
          };
        }
        const instructions = ctx.getSkillStage(args.stage);
        if (!instructions) {
          return {
            ok: false,
            error: `The active skill "${skillName}" does not provide a "${args.stage}" stage.`,
            hint: 'Continue without instructions for this stage.',
          };
        }
        return {
          ok: true,
          message: `Skill "${skillName}" — ${args.stage} instructions (apply these now):\n\n${instructions}`,
          data: { stage: args.stage, instructions },
        };
      },
    }) as Tool,
  ];
  return tools;
}

// Re-export Theme for callers that build a DeckToolContext.
export type { Theme };
