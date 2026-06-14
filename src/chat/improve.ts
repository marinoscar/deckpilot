import { basename, extname } from 'node:path';
import { slugify } from '../store/paths.js';
import { countPptxSlides } from './transform.js';

/**
 * Shared text + helpers for "improve" mode: read an existing SOURCE deck,
 * critique it, and rebuild a markedly better version in a chosen brand
 * TEMPLATE's style. Kept here (not in session.ts) so the command and the TUI
 * import the exact same prompt/contract.
 *
 * Unlike `transform` (a strict 1:1 restyle), `improve` rewrites: it sharpens
 * copy/structure/notes AND redesigns layout/visual hierarchy. The template is
 * a required, user-chosen brand look; the skill is optional.
 */

/** Re-export so importers don't need to reach into transform.ts. */
export { countPptxSlides };

/** How many source slides to rasterize for the vision pass (token-budget cap). */
export const IMPROVE_STUDY_MAX_SLIDES = 60;

/**
 * Per-document / total context budget for the seeded source text. Much larger
 * than the chat default (60k/150k) because a faithful critique needs the WHOLE
 * source; `study_source_slides` images backstop anything still beyond this.
 */
export const IMPROVE_DOC_CHAR_BUDGET = 250_000;

/** Filename of the written improvement plan, saved into the project directory. */
export const IMPROVEMENT_PLAN_FILENAME = 'IMPROVEMENT-PLAN.md';

/**
 * The kickoff user message. The source deck's full extracted text is attached
 * to this message as reference context; the binding rules live in
 * `renderImproveGuidance()` (system prompt). Kept concise on screen.
 */
export const IMPROVE_SEED_PROMPT = [
  'Quality-check the attached SOURCE deck and rebuild a markedly better version in the active TEMPLATE’s visual style.',
  '',
  'The source deck’s full text (every slide’s title, body, bullets, tables, and speaker notes) is attached below as reference. Read all of it.',
  '',
  'Work in this order:',
  '1. Call study_source_slides once to see how each slide currently looks.',
  '2. Call save_improvement_plan with a candid assessment (overall strengths/weaknesses + per-slide recommendations) — this writes the plan to a file and shows it to me.',
  '3. Call propose_deck_brief with the improved deck that embodies that plan, then STOP — wait for me to reply “build” before writing any slide code.',
].join('\n');

/** The durable improve contract appended to the system prompt in improve mode. */
export function renderImproveGuidance(): string {
  return [
    '## Improve mode: quality-check & rebuild (binding)',
    '',
    "This session reads an existing SOURCE deck, critiques it, and rebuilds a markedly BETTER version in the active TEMPLATE's visual style. This is a rewrite, not a 1:1 reproduction.",
    '',
    '### Goal',
    '- Produce a deck that is clearly better than the source on BOTH content and design.',
    '- Content: a stronger narrative arc, sharper and more specific titles, tighter bullets (cut filler, fix vague claims), and richer, presenter-ready speaker notes.',
    '- Design is a first-class requirement, not an afterthought: every slide must look polished — clear visual hierarchy, generous whitespace, consistent type and colour from the template, and purposeful, varied layouts (covers, section dividers, comparisons, data slides). No wall-of-text slides.',
    '',
    '### Freedom & fidelity',
    '- You MAY rewrite wording, and merge, split, reorder, add, or drop slides to improve flow — this is not a 1:1 mapping.',
    "- Preserve the source's facts, figures, data, and intent. Improve the expression; never invent data or change the meaning.",
    '- Keep genuinely strong material intact rather than changing it for the sake of change.',
    '',
    '### Style (from the TEMPLATE)',
    '- The active template is the ONLY source of visual style: its palette, fonts, master/brand chrome, and layout language. Build the theme and every slide to match it.',
    "- Ignore the SOURCE deck's original colours, fonts, and decorative styling completely.",
    "- Adopt the template's aspect ratio; reflow content to fit it.",
    '',
    '### Seeing the source',
    '- `study_source_slides` rasterises the SOURCE deck to images. Call it ONCE, before saving the plan, to judge each slide’s current content AND design (what’s cramped, dull, inconsistent, or thin). Take NO styling cues from these images — they show the OLD look you are replacing.',
    '',
    '### Workflow',
    '- Phase 1: call `save_improvement_plan` (overall assessment + per-slide recommendations) BEFORE `propose_deck_brief`. Then propose the improved brief, present it, and WAIT for the user’s “build” approval. The approval gate is not waived in improve mode.',
    '- The output brief is capped at 40 slides — consolidate long sources accordingly.',
    '- Phases 2–3: author each slide in the TEMPLATE style, run the normal critique loop, then save. After saving, stay in chat for adjustments.',
  ].join('\n');
}

/** Default project name for an improve run: `<source-stem>-improved`, slugified. */
export function defaultImproveProjectName(sourcePath: string): string {
  const stem = basename(sourcePath, extname(sourcePath));
  const base = slugify(stem) || 'deck';
  // Leave room for the suffix within the 64-char project-name cap.
  return `${base.slice(0, 52)}-improved`;
}
