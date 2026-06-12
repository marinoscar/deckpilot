import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import JSZip from 'jszip';
import { slugify } from '../store/paths.js';

/**
 * Shared text + helpers for "transform" mode: reproduce an ORIGINAL deck's
 * content in a TARGET deck's visual style. Kept here (not in session.ts) so the
 * command and the TUI import the exact same prompt/contract.
 */

/**
 * Hard ceiling on a transformable deck. Mirrors `DeckBriefSchema.slides.max(40)`
 * in `src/deck/brief.ts` — a brief can't hold more than 40 slides, so a strict
 * 1:1 transform of a larger original can't be represented. Counted up front so
 * we fail with a clear message instead of a mid-run brief-validation error.
 */
export const MAX_TRANSFORM_SLIDES = 40;

/** How many original slides to rasterize for the vision pass (token-budget cap). */
export const TRANSFORM_STUDY_MAX_SLIDES = 60;

/**
 * Per-document / total context budget for the seeded original text. Much larger
 * than the chat default (60k/150k) because strict 1:1 needs the WHOLE original;
 * `study_original_slides` images backstop anything still beyond this.
 */
export const TRANSFORM_DOC_CHAR_BUDGET = 250_000;

/**
 * The kickoff user message. The original deck's full extracted text is attached
 * to this message as reference context; the binding rules live in
 * `renderTransformGuidance()` (system prompt). Kept concise on screen.
 */
export const TRANSFORM_SEED_PROMPT = [
  'Transform the attached ORIGINAL deck into the active TARGET template’s visual style — a strict 1:1 restyle, not a rewrite.',
  '',
  'The original deck’s full text (every slide’s title, body, bullets, tables, and speaker notes) is attached below as reference. Reproduce ALL of it: same slide count, same order, same wording, same notes — only the look changes to the target’s palette, fonts, and brand.',
  '',
  'First call study_original_slides once to see each source slide. Then call propose_deck_brief with one slide per source slide and STOP — wait for me to reply “build” before writing any slide code.',
].join('\n');

/** The durable transform contract appended to the system prompt in transform mode. */
export function renderTransformGuidance(): string {
  return [
    '## Transform mode: 1:1 restyle (binding)',
    '',
    "This session restyles an ORIGINAL deck into a TARGET deck's visual style. It is a strict reproduction, not a rewrite.",
    '',
    '### Content contract (from the ORIGINAL)',
    '- Reproduce EVERY source slide, in the SAME ORDER, one brief slide per source slide. Same slide count — never add, drop, merge, split, or reorder.',
    '- Reproduce all content verbatim: titles, body text, bullets, and tables.',
    "- Reproduce each source slide's speaker notes into that slide's `notes`.",
    '- Do not summarise, paraphrase, or “improve” the wording. Keep sparse slides sparse. The original’s extracted text (attached to the first user message) is the authoritative content source; if it looks truncated, rely on the study_original_slides images for the missing slides.',
    '',
    '### Style contract (from the TARGET)',
    '- The TARGET deck is loaded as the active style template: its palette, fonts, master/brand chrome, and layout language are the ONLY source of visual style. Build the theme and every slide to match the TARGET.',
    "- Ignore the ORIGINAL's colours, fonts, and decorative styling completely.",
    "- Adopt the TARGET's aspect ratio; reflow each source slide's content to fit it — do not assume the original's dimensions.",
    '',
    '### Seeing the source',
    '- `study_original_slides` rasterises the ORIGINAL deck to images. Call it ONCE before proposing the brief, to understand each slide’s content and structure (cover vs. section divider vs. table vs. body). Take NO styling cues from these images — they show the OLD look you are replacing.',
    '',
    '### Workflow',
    '- Phase 1: propose the brief (one slide per source slide, content + notes carried over, theme = TARGET style), present it, and WAIT for the user’s “build” approval. The approval gate is not waived in transform mode.',
    '- Phases 2–3: author each slide in the TARGET style, run the normal critique loop, then save. After saving, stay in chat for adjustments.',
  ].join('\n');
}

/** Default project name for a transform: `<original-stem>-transformed`, slugified. */
export function defaultTransformProjectName(originalPath: string): string {
  const stem = basename(originalPath, extname(originalPath));
  const base = slugify(stem) || 'deck';
  // Leave room for the suffix within the 64-char project-name cap.
  return `${base.slice(0, 50)}-transformed`;
}

/** Count slide parts in a .pptx (ppt/slides/slideN.xml). Throws on a bad file. */
export async function countPptxSlides(path: string): Promise<number> {
  const zip = await JSZip.loadAsync(await readFile(path));
  return Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length;
}
