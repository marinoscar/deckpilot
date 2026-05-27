/**
 * DeckBrief — Phase 1 output in the code-gen pipeline.
 *
 * The LLM proposes a brief (meta + theme + per-slide intent) BEFORE writing
 * any rendering code. The brief is what the user approves; Phase 2 then
 * elaborates each slide into a render() function fed through the sandbox.
 *
 * Brief is intentionally light. It carries titles, purposes, speaker notes —
 * but no layout, no composition kind, no coordinates. All visual decisions
 * are made inside the slide code, not here.
 */
import { z } from 'zod';
import { ThemeSchema } from './theme.js';

const SlideId = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/i, 'Slide ids may only contain letters, digits, and hyphens.');

const ShortText = z.string().min(1).max(160);
const TitleText = z.string().min(1).max(160);
const NotesText = z.string().max(2000);
const PurposeText = z.string().min(1).max(400);

export const SlideBriefSchema = z.object({
  id: SlideId,
  title: TitleText.describe(
    'Short, assertive slide title — used by both the LLM-generated code and the outline summary.',
  ),
  purpose: PurposeText.describe(
    'One or two sentences saying what this slide should communicate. Used as the brief the LLM consults when writing the slide-render function.',
  ),
  notes: NotesText.optional().describe('Speaker notes — plain prose, no markdown.'),
});
export type SlideBrief = z.infer<typeof SlideBriefSchema>;

export const DeckMetaSchema = z.object({
  title: TitleText,
  subtitle: ShortText.optional(),
  author: ShortText.optional(),
  audience: ShortText.optional().describe(
    'Free-form audience description, e.g. "informed-generalist execs".',
  ),
});
export type DeckMeta = z.infer<typeof DeckMetaSchema>;

export const DeckBriefSchema = z
  .object({
    schemaVersion: z
      .literal('1.0')
      .default('1.0')
      .describe('Bumped on breaking shape changes so saved briefs are detectable.'),
    meta: DeckMetaSchema,
    theme: ThemeSchema.describe('Deck-wide theme. Set once, read by every slide render function.'),
    slides: z.array(SlideBriefSchema).min(1).max(40),
  })
  .superRefine((brief, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < brief.slides.length; i++) {
      const id = brief.slides[i]!.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate slide id "${id}" — every slide must have a unique id.`,
          path: ['slides', i, 'id'],
        });
      }
      seen.add(id);
    }
  });
export type DeckBrief = z.infer<typeof DeckBriefSchema>;

/**
 * Pretty-print a zod ZodError for LLM consumption. Returns a flat string with
 * one line per issue, paths joined with dots.
 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `  ${path}: ${i.message}`;
    })
    .join('\n');
}

/** Compact one-paragraph summary used by `/outline` and tool acknowledgements. */
export function summarizeBrief(brief: DeckBrief): string {
  const t = brief.theme;
  return [
    `${brief.meta.title}${brief.meta.subtitle ? ` — ${brief.meta.subtitle}` : ''} (${brief.slides.length} slides, ${t.aspect})`,
    `theme: tone=${t.tone}, accent=#${t.accent}, accentAlt=#${t.accentAlt}, font=${t.fontHeading}/${t.fontBody}`,
    ...brief.slides.map((s, i) => `  ${i + 1}. [${s.id}] ${s.title} — ${s.purpose}`),
  ].join('\n');
}
