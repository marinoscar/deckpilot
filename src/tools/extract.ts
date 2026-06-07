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
import {
  type TemplateSpec,
  TemplateSpecSchema,
  formatZodError,
  summarizeTemplate,
} from '../template/spec.js';

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
  /**
   * v0.16: OOXML pre-extraction result. The orchestrator runs this BEFORE
   * launching the LLM session and hands the result here. `master`,
   * `paletteSamples`, and donor `shapes` come from this — the LLM only
   * authors creative fields + donor summaries. Their values in the LLM's
   * save_template payload are ignored and overwritten with these.
   */
  preExtracted?: TemplateSpec;
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
              'The pptx-glimpse renderer is unavailable; cannot render slides. The orchestrator will fall back to OOXML-only extraction.',
            resultType: 'failure' as const,
            error: 'preview_unavailable',
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
        const preExtractedSummary = ctx.preExtracted ? summarizePreExtracted(ctx.preExtracted) : '';
        return {
          textResultForLlm: [
            note,
            preExtractedSummary,
            `Examine each image, then call save_template once with a complete TemplateSpec named "${ctx.templateName}". Do NOT ask the user to confirm.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
          binaryResultsForLlm: binaries,
          resultType: 'success' as const,
        };
      },
    }) as Tool,

    defineTool('save_template', {
      description: [
        "Save the TemplateSpec to disk. Author the CREATIVE fields — description, brand, theme tone, voiceHints, copyRules, guidance, and a one-line summary per donor slide (donorGeometry[i].summary). The OOXML extractor already filled in palette / fonts / aspect / master / paletteSamples / donor geometry from the source .pptx; pass them through unchanged. If you provide alternative values for those pre-extracted fields, they'll be overwritten with the OOXML versions.",
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
        // Merge: keep the LLM's creative fields, substitute the OOXML
        // pre-extracted master / palette / donor positions, preserve any
        // donor summaries the LLM authored.
        const finalSpec = mergeWithPreExtracted(parsed.data, ctx.preExtracted);
        try {
          const { rootDir } = await saveNamedTemplate(finalSpec, { overwrite: ctx.overwrite });
          ctx.onSaved(rootDir);
          return {
            ok: true,
            message: `Saved template "${finalSpec.name}" (${summarizeTemplate(finalSpec)}) to ${rootDir}.`,
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

/**
 * Format a compact summary of the OOXML pre-extraction the LLM should be
 * aware of. Appended to study_pptx_slides's tool result so the LLM doesn't
 * have to redo work the extractor already did deterministically.
 */
function summarizePreExtracted(spec: TemplateSpec): string {
  const lines: string[] = [
    '### OOXML pre-extracted (deterministic — do not re-derive)',
  ];
  lines.push(
    `- Theme: accent #${spec.theme.accent}, accentAlt #${spec.theme.accentAlt}, fonts ${spec.theme.fontHeading} / ${spec.theme.fontBody}, aspect ${spec.theme.aspect}.`,
  );
  if (spec.master) {
    const parts: string[] = [];
    if (spec.master.background?.type === 'solid')
      parts.push(`background #${spec.master.background.color}`);
    else if (spec.master.background?.type === 'image') parts.push('background (image)');
    if (spec.master.objects?.length) parts.push(`${spec.master.objects.length} object(s)`);
    lines.push(`- Master extracted: ${parts.join(', ') || '(empty)'}.`);
  }
  if (spec.assets?.background) {
    lines.push(
      `- Cover background extracted to ${spec.assets.background} (the title/cover full-bleed image; the renderer surfaces it as theme.assets.background for covers/dividers).`,
    );
  }
  if (spec.themePalette) {
    const named = Object.entries(spec.themePalette)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k} #${v}`)
      .join(', ');
    if (named) lines.push(`- Theme colour scheme: ${named}.`);
  }
  if (spec.paletteSamples?.length) {
    lines.push(
      `- Palette samples (${spec.paletteSamples.length}): ${spec.paletteSamples.map((h) => `#${h}`).join(', ')}.`,
    );
  }
  if (spec.donorGeometry?.length) {
    lines.push(`- Donor slides catalogued: ${spec.donorGeometry.length}.`);
    lines.push(
      "  Author a tight one-line `summary` for each — what's the slide's visual purpose?",
    );
    for (const d of spec.donorGeometry) {
      const shapes = d.shapes.map((s) => `${s.name}(${s.kind})`).join(', ');
      lines.push(
        `    - [${d.index}] ${d.name}${d.layoutName ? ` (layout: ${d.layoutName})` : ''} — shapes: ${shapes || '(none)'}`,
      );
    }
  }
  lines.push(
    '',
    'Your job: fill in description, brand, theme.tone if needed, voiceHints, copyRules, guidance, AND a one-line summary for each donor in donorGeometry. The extractor populated the master, paletteSamples, and donor positions — pass them through unchanged.',
  );
  return lines.join('\n');
}

/**
 * Take the LLM-authored spec and (optionally) merge with the OOXML
 * pre-extraction. The OOXML fields are authoritative for `master`,
 * `paletteSamples`, and the geometric portion of `donorGeometry`; the LLM's
 * `summary` field on each donor is kept.
 */
function mergeWithPreExtracted(
  llm: TemplateSpec,
  pre: TemplateSpec | undefined,
): TemplateSpec {
  if (!pre) return llm;
  const merged: TemplateSpec = { ...llm };

  // Master + paletteSamples — always prefer the OOXML extraction.
  if (pre.master) merged.master = pre.master;
  else if (llm.master) merged.master = llm.master;

  if (pre.paletteSamples) merged.paletteSamples = pre.paletteSamples;
  else if (llm.paletteSamples) merged.paletteSamples = llm.paletteSamples;

  // themePalette — the canonical clrScheme is deterministic; prefer OOXML.
  if (pre.themePalette) merged.themePalette = pre.themePalette;
  else if (llm.themePalette) merged.themePalette = llm.themePalette;

  // assets — the cover background is copied to disk during pre-extraction, so
  // the OOXML value is authoritative. Keep any LLM-authored logo/wordmark refs.
  if (pre.assets || llm.assets) {
    const mergedAssets = { ...llm.assets, ...pre.assets };
    if (Object.keys(mergedAssets).length > 0) merged.assets = mergedAssets;
  }

  // donorGeometry: use OOXML positions, accept LLM summaries by index.
  if (pre.donorGeometry) {
    const llmSummariesByIndex = new Map<number, string>();
    for (const d of llm.donorGeometry ?? []) {
      if (d.summary?.trim()) llmSummariesByIndex.set(d.index, d.summary.trim());
    }
    merged.donorGeometry = pre.donorGeometry.map((d) => ({
      ...d,
      summary: llmSummariesByIndex.get(d.index) ?? d.summary ?? '',
    }));
  } else if (llm.donorGeometry) {
    merged.donorGeometry = llm.donorGeometry;
  }

  return merged;
}
