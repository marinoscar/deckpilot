import { z } from 'zod';

/**
 * DeckPilot v0.5 schema. Replaces the v0.4 discriminated layout union with a
 * design-system + composition model:
 *
 *   DesignSystem — set once per deck (palette, fonts, tone, decorative habits)
 *   ComposableSlide — describes a slide as a composition (prose / grid / steps
 *                     / callout / quote) plus optional kicker, title, subtitle,
 *                     footer. No fixed "layout" field — the slide's visual
 *                     shape emerges from `body.kind` + the DesignSystem.
 *
 * The LLM emits a SlidePlan whose `slides` are ComposableSlides. The renderer
 * interprets the composition through a primitive library so the same plan can
 * produce 2/3/4-column card grids without the LLM ever specifying coordinates.
 *
 * Constraints are part of how DeckPilot enforces good visual design — short
 * titles, capped grid sizes, kicker length limits, etc.
 */

// ---------- atoms ----------

const HexColor = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'Hex colour without leading # — 6 hex digits, e.g. "1A2B5E".');

const SlideId = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/i, 'Slide ids may only contain letters, digits, and hyphens.');

const KickerText = z.string().min(1).max(60); // "IN PLAIN ENGLISH"
const TitleText = z.string().min(1).max(110);
const ShortText = z.string().min(1).max(160);
const BulletText = z.string().min(1).max(220);
const LongText = z.string().min(1).max(400);
const StatementText = z.string().min(1).max(280);
const NotesText = z.string().max(2000);
const NumberLabel = z.string().min(1).max(4); // "01", "1", "I"

export const BulletSchema = z.object({
  text: BulletText,
  level: z.union([z.literal(0), z.literal(1)]).default(0),
});
export type Bullet = z.infer<typeof BulletSchema>;

// ---------- DesignSystem ----------

const ToneEnum = z.enum(['editorial', 'minimal', 'corporate', 'energetic', 'studious']);
export type Tone = z.infer<typeof ToneEnum>;

const NumberStyleEnum = z.enum(['circle', 'pill']);
const CardStyleEnum = z.enum(['side-bar', 'top-bar', 'plain']);

export const DesignSystemSchema = z.object({
  // Palette
  accent: HexColor.describe('Primary brand accent colour. Used for titles, primary cards, kickers.'),
  accentAlt: HexColor.describe(
    'Secondary accent. The references pair navy with red — pick a complementary tone.',
  ),
  ink: HexColor.default('1F2328').describe('Primary text colour. Near-black.'),
  muted: HexColor.default('6E7781').describe('Captions, page numbers, dividers.'),
  paper: HexColor.default('FFFFFF').describe('Slide background.'),
  cardTint: HexColor.default('F4F7FC').describe('Subtle tint behind primary cards.'),
  cardTintAlt: HexColor.default('FDF4F5').describe('Subtle tint behind alt-accent cards.'),

  // Type
  fontHeading: z.string().min(1).max(64).default('Inter Tight'),
  fontBody: z.string().min(1).max(64).default('Inter'),

  // Voice / tone — shapes the LLM's wording and the renderer's defaults
  tone: ToneEnum.default('editorial'),

  // Decorative habits the renderer reads when drawing every slide
  useKickers: z
    .boolean()
    .default(true)
    .describe('Whether to draw the small all-caps "IN PLAIN ENGLISH"-style label above titles.'),
  useFooterBand: z
    .boolean()
    .default(true)
    .describe('Whether to draw the bottom footer band with deck title / section / page count.'),
  cornerAccents: z
    .boolean()
    .default(false)
    .describe('Optional decorative dots/triangles in slide corners. Use sparingly.'),
  numberStyle: NumberStyleEnum.default('circle').describe('How numbered items render in grids and steps.'),
  cardStyle: CardStyleEnum.default('side-bar').describe(
    'Where each card\'s accent strip lives. Side-bar = image 1; top-bar = image 2.',
  ),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

// ---------- compositions ----------

const GlyphEnum = z.enum([
  'table',
  'network',
  'equals',
  'check',
  'cross',
  'spark',
  'bars',
  'pie',
  'grid',
  'cursor',
]);
export type Glyph = z.infer<typeof GlyphEnum>;

const AccentRef = z.enum(['primary', 'alt']);
export type AccentRef = z.infer<typeof AccentRef>;

export const GridItemSchema = z.object({
  kicker: KickerText.optional().describe('Small all-caps label above the card title (e.g. "SEMANTIC MODEL").'),
  number: NumberLabel.optional().describe('Optional "01"-style number rendered as a circle or pill.'),
  title: TitleText.describe('Card title — short and assertive.'),
  body: z
    .union([LongText, z.array(BulletSchema).min(1).max(5)])
    .optional()
    .describe('Either one paragraph of body text, or up to 5 bullets.'),
  cta: ShortText.optional().describe(
    'Filled-pill call-to-action at the bottom of the card, e.g. "LETS YOU → SEARCH".',
  ),
  glyph: GlyphEnum.optional().describe('Optional mini-infographic glyph drawn from primitives.'),
  accent: AccentRef.default('primary'),
});
export type GridItem = z.infer<typeof GridItemSchema>;

export const StepItemSchema = z.object({
  number: NumberLabel,
  title: TitleText,
  description: ShortText.optional(),
  accent: AccentRef.default('primary'),
});
export type StepItem = z.infer<typeof StepItemSchema>;

export const ProseCompositionSchema = z.object({
  kind: z.literal('prose'),
  lead: LongText.optional().describe('Optional 1-2 sentence intro before bullets.'),
  bullets: z.array(BulletSchema).min(1).max(6).optional(),
});

export const GridCompositionSchema = z.object({
  kind: z.literal('grid'),
  columns: z
    .union([z.literal(2), z.literal(3), z.literal(4)])
    .describe('Number of columns. 2 = comparison, 3 = stages, 4 = progression.'),
  items: z.array(GridItemSchema).min(2).max(4),
});

export const StepsCompositionSchema = z.object({
  kind: z.literal('steps'),
  items: z.array(StepItemSchema).min(2).max(6),
});

export const CalloutCompositionSchema = z.object({
  kind: z.literal('callout'),
  statement: StatementText.describe('The single bold takeaway sentence.'),
  lead: ShortText.optional(),
});

export const QuoteCompositionSchema = z.object({
  kind: z.literal('quote'),
  text: z.string().min(1).max(320),
  attribution: ShortText.optional(),
});

export const CompositionSchema = z.discriminatedUnion('kind', [
  ProseCompositionSchema,
  GridCompositionSchema,
  StepsCompositionSchema,
  CalloutCompositionSchema,
  QuoteCompositionSchema,
]);
export type Composition = z.infer<typeof CompositionSchema>;
export type CompositionKind = Composition['kind'];

// ---------- ComposableSlide ----------

const BackgroundEnum = z.enum(['paper', 'accent', 'accentAlt']);
export type Background = z.infer<typeof BackgroundEnum>;

export const SlideFooterSchema = z.object({
  section: ShortText.optional().describe('Section name shown in the footer band (e.g. "Decision Framework").'),
  page: z.number().int().positive().optional().describe('Override page number — usually leave unset.'),
});

export const SlideSchema = z
  .object({
    id: SlideId,
    kicker: KickerText.optional(),
    title: TitleText.optional(),
    subtitle: ShortText.optional(),
    body: CompositionSchema.optional(),
    notes: NotesText.optional(),
    background: BackgroundEnum.default('paper'),
    footer: SlideFooterSchema.optional(),
  })
  .superRefine((slide, ctx) => {
    // A slide must have at least one of title / body / kicker to be worth rendering.
    if (!slide.title && !slide.body && !slide.kicker) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Slide is empty — provide at least a title, kicker, or body composition.',
      });
    }
  });
export type Slide = z.infer<typeof SlideSchema>;

// ---------- SlidePlan ----------

export const SlidePlanSchema = z
  .object({
    schemaVersion: z
      .literal('0.5')
      .default('0.5')
      .describe('Plan schema version. Bump on breaking changes so /load can detect old plans.'),
    meta: z.object({
      title: TitleText,
      subtitle: ShortText.optional(),
      author: ShortText.optional(),
      audience: ShortText.optional(),
      aspect: z.union([z.literal('16:9'), z.literal('4:3')]).default('16:9'),
    }),
    design: DesignSystemSchema.describe(
      'The deck-wide visual guideline. Should be set via the set_design_system tool BEFORE proposing the outline; once locked in, every slide is rendered against it.',
    ),
    slides: z.array(SlideSchema).min(1).max(40),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < plan.slides.length; i++) {
      const id = plan.slides[i]!.id;
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
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

/**
 * Patch applied to a single slide via the `revise_slide` tool. Each field is
 * optional; only present fields are overwritten. The whole `body` is treated
 * as one atomic field (you replace it as a unit), since changing composition
 * kind would invalidate sibling fields otherwise.
 */
export const SlidePatchSchema = z.object({
  kicker: KickerText.optional(),
  title: TitleText.optional(),
  subtitle: ShortText.optional(),
  body: CompositionSchema.optional(),
  notes: NotesText.optional(),
  background: BackgroundEnum.optional(),
  footer: SlideFooterSchema.optional(),
});
export type SlidePatch = z.infer<typeof SlidePatchSchema>;

/**
 * Pretty-print a zod ZodError for the LLM. Returns a flat string with one
 * line per issue, paths joined with dots. The LLM uses these to self-correct.
 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `  ${path}: ${i.message}`;
    })
    .join('\n');
}
