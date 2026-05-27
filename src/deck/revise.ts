import { type SlidePlan, type SlidePatch, SlideSchema, type Slide, type Composition } from './schema.js';

/**
 * Apply a partial patch to one slide in a plan. Returns a new plan; the
 * original is not mutated. Throws if the slide id is unknown or the merged
 * slide no longer validates.
 *
 * In the v0.5 schema there is no fixed `layout` — slides are described as
 * composition (prose / grid / steps / callout / quote). Patching a slide
 * means overwriting any of its top-level fields. The `body` field is treated
 * as one atomic unit; you can't deep-patch a grid item via this helper.
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
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) filtered[k] = v;
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
  const head = s.title ?? s.kicker ?? '(untitled)';
  const body = s.body ? describeBody(s.body) : 'no body';
  return `[${s.id}] ${body} · ${head}`;
}

function describeBody(b: Composition): string {
  switch (b.kind) {
    case 'prose': {
      const n = b.bullets?.length ?? 0;
      return `prose (${n} bullet${n === 1 ? '' : 's'}${b.lead ? ', lead' : ''})`;
    }
    case 'grid':
      return `${b.columns}-col grid (${b.items.length} items)`;
    case 'steps':
      return `steps (${b.items.length})`;
    case 'callout':
      return 'callout';
    case 'quote':
      return 'quote';
  }
}

export function summarizePlan(plan: SlidePlan): string {
  const ds = plan.design;
  return [
    `${plan.meta.title}${plan.meta.subtitle ? ` — ${plan.meta.subtitle}` : ''} (${plan.slides.length} slides, ${plan.meta.aspect})`,
    `design: tone=${ds.tone}, accent=#${ds.accent}, accentAlt=#${ds.accentAlt}, font=${ds.fontHeading}/${ds.fontBody}, cardStyle=${ds.cardStyle}`,
    ...plan.slides.map((s) => '  ' + summarizeSlide(s)),
  ].join('\n');
}
