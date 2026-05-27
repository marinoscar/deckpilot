import { type SlidePlan, type SlidePatch, SlideSchema, type Slide, type SlideLayout } from './schema.js';

/**
 * Set of patch fields that are meaningful per layout. Anything outside this
 * set is rejected as a typed-but-misapplied edit (e.g. "body" on a title
 * slide). The LLM sees the error and corrects rather than silently dropping
 * the change.
 */
const ALLOWED_PATCH_KEYS: Record<SlideLayout, ReadonlySet<string>> = {
  title: new Set(['title', 'subtitle', 'author', 'date', 'notes']),
  content: new Set(['title', 'subtitle', 'body', 'notes']),
  'two-col': new Set(['title', 'subtitle', 'left', 'right', 'notes']),
  section: new Set(['title', 'number', 'notes']),
  quote: new Set(['quote', 'attribution', 'notes']),
  closing: new Set(['title', 'subtitle', 'contact', 'notes']),
};

/**
 * Apply a partial patch to one slide in a plan. Returns a new plan; the
 * original is not mutated. Throws if the slide id is unknown, the patch
 * targets a field that isn't valid for the slide's layout, or the merged
 * slide no longer validates.
 *
 * Cannot change `layout` — removing+re-adding is the right move there.
 */
export function applySlidePatch(
  plan: SlidePlan,
  slideId: string,
  patch: SlidePatch,
): { plan: SlidePlan; slide: Slide } {
  const idx = plan.slides.findIndex((s) => s.id === slideId);
  if (idx < 0) {
    throw new Error(`No slide with id "${slideId}". Use propose_outline to see ids.`);
  }
  const current = plan.slides[idx]!;
  const allowed = ALLOWED_PATCH_KEYS[current.layout];
  const filtered: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!allowed.has(k)) {
      rejected.push(k);
      continue;
    }
    filtered[k] = v;
  }
  if (rejected.length > 0) {
    throw new Error(
      `Patch fields not valid for layout "${current.layout}": ${rejected.join(', ')}. ` +
        `Valid fields are: ${[...allowed].join(', ')}. ` +
        `To change layout, call propose_outline with the full updated plan.`,
    );
  }
  const merged = { ...current, ...filtered };
  const parsed = SlideSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `Patch produced an invalid slide:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  const next = { ...plan, slides: [...plan.slides] };
  next.slides[idx] = parsed.data;
  return { plan: next, slide: parsed.data };
}

/**
 * Compact one-line summary of a slide, used by `/outline` and tool responses
 * so the LLM (and the user) can see the deck at a glance.
 */
export function summarizeSlide(s: Slide): string {
  switch (s.layout) {
    case 'title':
      return `[${s.id}] title · "${s.title}"${s.subtitle ? ` — ${s.subtitle}` : ''}`;
    case 'content':
      return `[${s.id}] content · "${s.title}" (${s.body.length} bullet${s.body.length === 1 ? '' : 's'})`;
    case 'two-col':
      return `[${s.id}] two-col · "${s.title}" (${s.left.body.length} | ${s.right.body.length})`;
    case 'section':
      return `[${s.id}] section · "${s.title}"${s.number ? ` (#${s.number})` : ''}`;
    case 'quote':
      return `[${s.id}] quote · "${s.quote.slice(0, 60)}${s.quote.length > 60 ? '…' : ''}"`;
    case 'closing':
      return `[${s.id}] closing · "${s.title}"`;
  }
}

export function summarizePlan(plan: SlidePlan): string {
  return [
    `${plan.meta.title}${plan.meta.subtitle ? ` — ${plan.meta.subtitle}` : ''} (${plan.slides.length} slides, ${plan.meta.aspect})`,
    ...plan.slides.map((s) => '  ' + summarizeSlide(s)),
  ].join('\n');
}
