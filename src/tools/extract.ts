import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Tools registered ONLY in the headless template-extraction session. Kept
 * separate from `src/tools/index.ts` (which builds the rich tool surface
 * for chat) so the extraction surface stays small and focused:
 *
 *   study_pptx_slides — render the source .pptx to PNGs and hand them
 *                       back to the model as image tool-result binaries.
 *   save_template     — validate + persist a TemplateSpec under
 *                       ~/.deckpilot/templates/<name>/.
 */
import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import { PreviewUnavailableError, isPreviewAvailable, pptxToPngs } from '../render/pptx-to-pngs.js';
import { TemplateExistsError, saveTemplate as saveNamedTemplate } from '../store/templates.js';
import { TemplateSpecSchema, formatZodError, summarizeTemplate } from '../template/spec.js';

type Result = { ok: true; message: string } | { ok: false; error: string; hint?: string };

export type ExtractContext = {
  /** Lower-case kebab template name picked at CLI invocation time. */
  templateName: string;
  /** Absolute path to the source .pptx to study. */
  pptxPath: string;
  /** When true, save_template is allowed to overwrite an existing template. */
  overwrite: boolean;
  /** Max slides to send to the model (cost / token budget cap). */
  maxSlides: number;
  /** Fires when save_template completes successfully — the orchestrator uses
   * this to know the session can disconnect. */
  onSaved: (savedDir: string) => void;
};

/** Build the two-tool surface for the extraction session. */
export function buildExtractTools(ctx: ExtractContext): Tool[] {
  return [
    defineTool('study_pptx_slides', {
      description: [
        'Render the source presentation slides to PNG images and return them so you can examine the brand visually.',
        'Call this BEFORE save_template, exactly once. The result includes one image per slide plus a short summary.',
        `Up to ${ctx.maxSlides} slides will be returned; longer decks are sampled from the start.`,
      ].join(' '),
      parameters: z.object({}),
      skipPermission: true,
      handler: async (_args, _invocation) => {
        if (!(await isPreviewAvailable())) {
          return {
            textResultForLlm:
              'LibreOffice is not available on PATH; cannot render slides. The orchestrator will fall back to OOXML-only extraction.',
            resultType: 'failure' as const,
            error: 'libreoffice_missing',
          };
        }
        const outDir = mkdtempSync(join(tmpdir(), 'deckpilot-extract-'));
        let pngs: string[];
        try {
          // 100 dpi is plenty for vision; smaller payloads = cheaper calls.
          pngs = await pptxToPngs(ctx.pptxPath, outDir, { dpi: 100 });
        } catch (e) {
          if (e instanceof PreviewUnavailableError) {
            return {
              textResultForLlm: e.message,
              resultType: 'failure' as const,
              error: 'preview_unavailable',
            };
          }
          return {
            textResultForLlm: `Slide rendering failed: ${(e as Error).message}`,
            resultType: 'failure' as const,
            error: 'render_failed',
          };
        }
        const used = pngs.slice(0, ctx.maxSlides);
        const truncated = pngs.length > used.length;
        const binaries: Array<{
          type: 'image';
          mimeType: string;
          data: string;
          description: string;
        }> = [];
        for (let i = 0; i < used.length; i++) {
          const buf = await readFile(used[i]!);
          binaries.push({
            type: 'image' as const,
            mimeType: 'image/png',
            data: buf.toString('base64'),
            description: `Slide ${i + 1} of ${pngs.length}`,
          });
        }
        const note = truncated
          ? `Returned the first ${used.length} of ${pngs.length} slides (token-budget cap). The brand is usually defined by the first slides — covers, section dividers, and a few representative body slides.`
          : `Returned all ${used.length} slides.`;
        return {
          textResultForLlm: `${note} Examine each image, then call save_template once with a complete TemplateSpec named "${ctx.templateName}". Do NOT ask the user to confirm.`,
          binaryResultsForLlm: binaries,
          resultType: 'success' as const,
        };
      },
    }) as Tool,

    defineTool('save_template', {
      description: [
        'Save the TemplateSpec to disk. Provide the FULL spec — palette, fonts, tone, aspect, voiceHints, copyRules, guidance.',
        `The name field MUST equal "${ctx.templateName}".`,
        'Call this exactly once, AFTER study_pptx_slides. Do not ask the user to confirm.',
      ].join(' '),
      parameters: TemplateSpecSchema,
      skipPermission: true,
      handler: async (spec): Promise<Result> => {
        const parsed = TemplateSpecSchema.safeParse(spec);
        if (!parsed.success) {
          return {
            ok: false,
            error: `TemplateSpec failed validation:\n${formatZodError(parsed.error)}`,
            hint: 'Fix the offending fields and resend.',
          };
        }
        if (parsed.data.name !== ctx.templateName) {
          return {
            ok: false,
            error: `name must be "${ctx.templateName}" (got "${parsed.data.name}").`,
          };
        }
        try {
          const { rootDir } = await saveNamedTemplate(parsed.data, { overwrite: ctx.overwrite });
          ctx.onSaved(rootDir);
          return {
            ok: true,
            message: `Saved template "${parsed.data.name}" (${summarizeTemplate(parsed.data)}) to ${rootDir}.`,
          };
        } catch (e) {
          if (e instanceof TemplateExistsError) {
            return {
              ok: false,
              error: e.message,
              hint: 'Pass --overwrite to the CLI, or pick a different name.',
            };
          }
          return { ok: false, error: `Save failed: ${(e as Error).message}` };
        }
      },
    }) as Tool,
  ];
}
