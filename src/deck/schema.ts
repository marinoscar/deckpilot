import { z } from 'zod';

/**
 * SlidePlan — the structured intermediate representation the LLM produces and
 * the renderer consumes. Constraints here are part of how DeckPilot enforces
 * good visual design: short titles, capped bullet counts, capped nesting.
 *
 * Each Slide is a discriminated union on `layout`. This gives the LLM a clear
 * per-layout schema and gives us free runtime validation via zod.
 */

const HexColor = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'Hex colour without leading # — 6 hex digits, e.g. "0F62FE".');

const SlideId = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/i, 'Slide ids may only contain letters, digits, and hyphens.');

const BulletText = z.string().min(1).max(220);
const ShortText = z.string().min(1).max(140);
const TitleText = z.string().min(1).max(90);
const NotesText = z.string().max(2000);

export const BulletSchema = z.object({
  text: BulletText,
  level: z.union([z.literal(0), z.literal(1)]).default(0),
});
export type Bullet = z.infer<typeof BulletSchema>;

const ColumnSchema = z.object({
  heading: ShortText.optional(),
  body: z.array(BulletSchema).min(1).max(6),
});
export type Column = z.infer<typeof ColumnSchema>;

const BaseFields = {
  id: SlideId,
  notes: NotesText.optional(),
};

export const TitleSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('title'),
  title: TitleText,
  subtitle: ShortText.optional(),
  author: ShortText.optional(),
  date: ShortText.optional(),
});

export const ContentSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('content'),
  title: TitleText,
  subtitle: ShortText.optional(),
  body: z.array(BulletSchema).min(1).max(6),
});

export const TwoColSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('two-col'),
  title: TitleText,
  subtitle: ShortText.optional(),
  left: ColumnSchema,
  right: ColumnSchema,
});

export const SectionSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('section'),
  title: TitleText,
  number: z.string().max(4).optional(),
});

export const QuoteSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('quote'),
  quote: z.string().min(1).max(320),
  attribution: ShortText.optional(),
});

export const ClosingSlideSchema = z.object({
  ...BaseFields,
  layout: z.literal('closing'),
  title: TitleText,
  subtitle: ShortText.optional(),
  contact: ShortText.optional(),
});

export const SlideSchema = z.discriminatedUnion('layout', [
  TitleSlideSchema,
  ContentSlideSchema,
  TwoColSlideSchema,
  SectionSlideSchema,
  QuoteSlideSchema,
  ClosingSlideSchema,
]);
export type Slide = z.infer<typeof SlideSchema>;
export type SlideLayout = Slide['layout'];

export const SlidePlanSchema = z
  .object({
    meta: z.object({
      title: TitleText,
      subtitle: ShortText.optional(),
      author: ShortText.optional(),
      audience: ShortText.optional(),
      aspect: z.union([z.literal('16:9'), z.literal('4:3')]).default('16:9'),
    }),
    theme: z
      .object({
        accent: HexColor.optional(),
        ink: HexColor.optional(),
        muted: HexColor.optional(),
        paper: HexColor.optional(),
        fontHeading: z.string().min(1).max(64).optional(),
        fontBody: z.string().min(1).max(64).optional(),
      })
      .optional(),
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
 * optional; only present fields are overwritten. Cannot change the slide's
 * `layout` (that would invalidate the slide's other fields) — the LLM should
 * remove the slide and re-propose if it wants to change layout.
 */
export const SlidePatchSchema = z.object({
  title: TitleText.optional(),
  subtitle: ShortText.optional(),
  body: z.array(BulletSchema).min(1).max(6).optional(),
  left: ColumnSchema.optional(),
  right: ColumnSchema.optional(),
  quote: z.string().min(1).max(320).optional(),
  attribution: ShortText.optional(),
  author: ShortText.optional(),
  date: ShortText.optional(),
  contact: ShortText.optional(),
  number: z.string().max(4).optional(),
  notes: NotesText.optional(),
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
