/**
 * SkillSpec — a named, reusable bundle of staged instructions stored under
 * `~/.deckpilot/skills/<name>/SKILL.md` (and shipped read-only built-ins under
 * the packaged `skills/` directory).
 *
 * A skill steers the AI at specific points of the deck workflow. Unlike a
 * template (which carries visual style — palette, fonts, chrome), a skill
 * carries *process* — markdown instructions that fire at one of three stages
 * mapped to DeckPilot's three workflow phases:
 *
 *   intake        → Phase 1 PLAN   (before propose_deck_brief)
 *   slide-check   → Phase 2 BUILD  (each write_slide_code)
 *   final-review  → Phase 3 REVIEW (before save_deck)
 *
 * The on-disk artifact is markdown — YAML-ish frontmatter plus one `## <stage>`
 * section per declared stage — NOT JSON. `parseSkillMarkdown` is the single
 * bridge from that text to a validated SkillSpec.
 */
import { z } from 'zod';

export const SKILL_STAGES = ['intake', 'slide-check', 'final-review'] as const;
export const SkillStageSchema = z.enum(SKILL_STAGES);
export type SkillStage = (typeof SKILL_STAGES)[number];

/** Human-readable note on which workflow phase each stage fires at. */
export const STAGE_PHASE: Record<SkillStage, string> = {
  intake: 'Phase 1 PLAN — before propose_deck_brief',
  'slide-check': 'Phase 2 BUILD — each write_slide_code',
  'final-review': 'Phase 3 FINAL REVIEW — before save_deck',
};

const SkillName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Skill names must be lower-case kebab (letters, digits, hyphens).');

const StageText = z.string().min(1).max(4096);

/** Parsed stage instructions, keyed by stage. Each is optional on its own. */
export const SkillInstructionsSchema = z.object({
  intake: StageText.optional(),
  'slide-check': StageText.optional(),
  'final-review': StageText.optional(),
});
export type SkillInstructions = z.infer<typeof SkillInstructionsSchema>;

export const SkillSpecSchema = z
  .object({
    schemaVersion: z.literal('1.0').default('1.0'),
    name: SkillName.describe('Must equal the parent directory name.'),
    description: z.string().min(1).max(200).describe('One-line summary shown in the skill picker.'),
    version: z.string().min(1).max(20).default('1.0'),
    stages: z.array(SkillStageSchema).min(1).max(3),
    instructions: SkillInstructionsSchema,
  })
  .refine((s) => s.stages.every((st) => (s.instructions[st]?.trim().length ?? 0) > 0), {
    message: 'Every declared stage must have a matching, non-empty "## <stage>" section.',
    path: ['instructions'],
  });
export type SkillSpec = z.infer<typeof SkillSpecSchema>;

/** SkillSpec with the directory it was loaded from + whether it's a built-in. */
export type ResolvedSkill = SkillSpec & {
  rootDir: string;
  builtin: boolean;
};

/** Pretty-print a ZodError, matching the format used elsewhere in the codebase. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `  ${path}: ${i.message}`;
    })
    .join('\n');
}

/** Compact one-line summary for the picker / `skill list`. */
export function summarizeSkill(spec: SkillSpec): string {
  return `${spec.name} — ${spec.description} (stages: ${spec.stages.join(', ')})`;
}

/**
 * Parse a SKILL.md document into a validated SkillSpec.
 *
 * Format (intentionally constrained so we need no YAML dependency):
 *
 *   ---
 *   name: my-skill
 *   description: One line.
 *   version: 1.0
 *   stages: [intake, slide-check, final-review]
 *   ---
 *
 *   ## intake
 *   ...markdown...
 *
 *   ## slide-check
 *   ...markdown...
 *
 * Frontmatter supports only `key: value` lines plus one inline `[...]` array
 * (`stages`). Nested YAML is rejected with a clear error.
 *
 * @param name The directory name; the spec's internal `name` must match it.
 */
export function parseSkillMarkdown(name: string, raw: string): SkillSpec {
  const text = raw.replace(/^﻿/, ''); // strip BOM
  const fm = splitFrontmatter(text, name);

  const front = parseFrontmatter(fm.frontmatter, name);
  const sections = parseStageSections(fm.body);

  const candidate = {
    schemaVersion: '1.0' as const,
    name: front.name,
    description: front.description,
    version: front.version,
    stages: front.stages,
    instructions: sections,
  };

  const result = SkillSpecSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(`Skill "${name}" failed validation:\n${formatZodError(result.error)}`);
  }
  if (result.data.name !== name) {
    throw new Error(
      `Skill "${name}" has mismatched internal name "${result.data.name}". Rename the directory or fix the frontmatter.`,
    );
  }
  return result.data;
}

function splitFrontmatter(text: string, name: string): { frontmatter: string; body: string } {
  if (!text.startsWith('---')) {
    throw new Error(
      `Skill "${name}" is malformed: SKILL.md must start with a "---" frontmatter block.`,
    );
  }
  // Match the opening fence and the next fence on its own line.
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    throw new Error(
      `Skill "${name}" is malformed: could not find the closing "---" of the frontmatter block.`,
    );
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

type Frontmatter = {
  name: string;
  description: string;
  version: string;
  stages: SkillStage[];
};

function parseFrontmatter(block: string, name: string): Frontmatter {
  const fields: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new Error(
        `Skill "${name}" frontmatter line is not "key: value": ${JSON.stringify(rawLine)}`,
      );
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = stripQuotes(value);
  }

  const description = fields.description;
  if (!description) {
    throw new Error(`Skill "${name}" frontmatter is missing a "description".`);
  }

  return {
    name: fields.name ?? name,
    description,
    version: fields.version ?? '1.0',
    stages: parseStageList(fields.stages, name),
  };
}

function parseStageList(value: string | undefined, name: string): SkillStage[] {
  if (!value) {
    throw new Error(`Skill "${name}" frontmatter is missing a "stages: [...]" list.`);
  }
  const inner = value.replace(/^\[/, '').replace(/\]$/, '');
  const parts = inner
    .split(',')
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Skill "${name}" declares an empty "stages" list.`);
  }
  for (const p of parts) {
    if (!(SKILL_STAGES as readonly string[]).includes(p)) {
      throw new Error(
        `Skill "${name}" declares unknown stage "${p}". Valid stages: ${SKILL_STAGES.join(', ')}.`,
      );
    }
  }
  return parts as SkillStage[];
}

/** Collect markdown under each `## <stage>` heading in the body. */
function parseStageSections(body: string): SkillInstructions {
  const out: SkillInstructions = {};
  // Split on level-2 headings, keeping the heading text.
  const lines = body.split(/\r?\n/);
  let current: SkillStage | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current) {
      const content = buffer.join('\n').trim();
      if (content) out[current] = content;
    }
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const title = heading[1].trim();
      current = (SKILL_STAGES as readonly string[]).includes(title) ? (title as SkillStage) : null;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Annotated SKILL.md scaffold — the file itself teaches the format. Written by
 * `skill create` and the TUI "new skill" flow so users have a working starting
 * point to edit by hand.
 */
export function blankSkillMarkdown(name: string): string {
  return `---
name: ${name}
description: A new DeckPilot skill — edit this file to taste.
version: 1.0
stages: [intake, slide-check, final-review]
---

<!--
  How a skill works
  -----------------
  A skill injects markdown instructions into the AI at three stages, each tied
  to a phase of deck creation:

    intake        ${STAGE_PHASE.intake}
    slide-check   ${STAGE_PHASE['slide-check']}
    final-review  ${STAGE_PHASE['final-review']}

  Rules:
  - Declare the stages you provide in the frontmatter "stages" list above.
  - Every declared stage needs a matching "## <stage>" section below.
  - Each section is capped at ~4096 characters.
  - Drop any stage you do not need (remove it from "stages" AND delete its section).
  - Your instructions STEER the AI; they never override the brief-approval gate,
    the slide-code API/sandbox, or save_deck semantics.
-->

## intake
Before proposing the brief, ask the user 2-4 clarifying questions to better
define the deck, and WAIT for answers before calling propose_deck_brief. For
example: who is the audience, what decision should this deck drive, and what is
the single thing they must remember?

## slide-check
For every slide, before accepting it, verify:
- one idea per slide,
- every claim is sourced or clearly framed as opinion.

## final-review
Read the whole deck before save_deck and confirm it holds together: consistent
voice, no redundant slides, and a clear takeaway on the closing slide.
`;
}
