import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import JSZip from 'jszip';
import { slugify } from '../store/paths.js';

/**
 * Shared text + helpers for "transform" mode: restyle a deck — reproduce its
 * content 1:1 while adopting the active template's visual style. Kept here (not
 * in session.ts) so the command and the TUI import the exact same
 * prompt/contract.
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
 * The kickoff user message. The deck's full extracted text is attached to this
 * message as reference context; the binding rules live in
 * `renderTransformGuidance()` (system prompt). Kept concise on screen.
 */
export const TRANSFORM_SEED_PROMPT = [
  'Restyle the attached deck into the active template’s visual style — a strict 1:1 restyle, not a rewrite.',
  '',
  'The deck’s full text (every slide’s title, body, bullets, tables, and speaker notes) is attached below as reference. Reproduce ALL of it: same slide count, same order, same wording, same notes — only the look changes to the active template’s palette, fonts, and brand.',
  '',
  'First call study_original_slides once to see each source slide. Then call propose_deck_brief with one slide per source slide. You do NOT need to wait for my approval in transform mode — once the brief is proposed, go straight into building every slide and then save the deck. When the deck is built, tell me where it is and stay in the chat so I can ask for changes.',
].join('\n');

/** The durable transform contract appended to the system prompt in transform mode. */
export function renderTransformGuidance(): string {
  return [
    '## Transform mode: 1:1 restyle (binding)',
    '',
    "This session restyles a deck into the active template's visual style. It is a strict reproduction of the deck's content, not a rewrite.",
    '',
    '### Content contract (from the deck)',
    '- Reproduce EVERY source slide, in the SAME ORDER, one brief slide per source slide. Same slide count — never add, drop, merge, split, or reorder.',
    '- Reproduce all content verbatim: titles, body text, bullets, and tables.',
    "- Reproduce each source slide's speaker notes into that slide's `notes`.",
    '- Do not summarise, paraphrase, or “improve” the wording. Keep sparse slides sparse. The deck’s extracted text (attached to the first user message) is the authoritative content source; if it looks truncated, rely on the study_original_slides images for the missing slides.',
    '',
    '### Style contract (from the active template)',
    '- The active template is the ONLY source of visual style: its palette, fonts, master/brand chrome, and layout language. Build the theme and every slide to match it.',
    "- Ignore the source deck's own colours, fonts, and decorative styling completely.",
    "- Adopt the template's aspect ratio; reflow each source slide's content to fit it — do not assume the source deck's dimensions.",
    '',
    '### Seeing the source',
    '- `study_original_slides` rasterises the source deck to images. Call it ONCE before proposing the brief, to understand each slide’s content and structure (cover vs. section divider vs. table vs. body). Take NO styling cues from these images — they show the OLD look you are replacing.',
    '',
    '### Workflow (automatic — the approval gate is WAIVED in transform mode)',
    '- Phase 1: propose the brief (one slide per source slide, content + notes carried over, theme = the active template’s style) and present it. Do NOT wait for a “build” reply — transform mode is the explicit exception to the brief-approval gate; proceed immediately.',
    '- Phases 2–3: author each slide in the template style, run the normal critique loop, then save the deck — all without pausing for approval.',
    '- After saving, report where the file is in one line and stay in chat so the user can request adjustments.',
  ].join('\n');
}

/** Default project name for a transform: `<deck-stem>-transformed`, slugified. */
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
