import { describe, expect, it } from 'vitest';
import {
  SKILL_STAGES,
  blankSkillMarkdown,
  parseSkillMarkdown,
  summarizeSkill,
} from '../src/skill/spec.js';

const GOOD = `---
name: exec-review
description: Intake interview plus a final pass.
version: 1.2
stages: [intake, final-review]
---

## intake
Ask the user three questions first.

## final-review
Read the deck as a skeptic.
`;

describe('parseSkillMarkdown', () => {
  it('parses frontmatter + stage sections into a validated spec', () => {
    const spec = parseSkillMarkdown('exec-review', GOOD);
    expect(spec.name).toBe('exec-review');
    expect(spec.description).toBe('Intake interview plus a final pass.');
    expect(spec.version).toBe('1.2');
    expect(spec.stages).toEqual(['intake', 'final-review']);
    expect(spec.instructions.intake).toContain('three questions');
    expect(spec.instructions['final-review']).toContain('skeptic');
    expect(spec.instructions['slide-check']).toBeUndefined();
  });

  it('summarizes a spec for the picker', () => {
    const spec = parseSkillMarkdown('exec-review', GOOD);
    expect(summarizeSkill(spec)).toBe(
      'exec-review — Intake interview plus a final pass. (stages: intake, final-review)',
    );
  });

  it('defaults version to 1.0 when omitted', () => {
    const md = `---
name: s
description: d
stages: [intake]
---
## intake
hi
`;
    expect(parseSkillMarkdown('s', md).version).toBe('1.0');
  });

  it('rejects a file without a frontmatter block', () => {
    expect(() => parseSkillMarkdown('x', '## intake\nhi\n')).toThrow(/must start with a "---"/);
  });

  it('rejects an unterminated frontmatter block', () => {
    expect(() => parseSkillMarkdown('x', '---\nname: x\n')).toThrow(/closing "---"/);
  });

  it('rejects an unknown stage in the stages list', () => {
    const md = `---
name: x
description: d
stages: [intake, bogus]
---
## intake
hi
`;
    expect(() => parseSkillMarkdown('x', md)).toThrow(/unknown stage "bogus"/);
  });

  it('rejects a declared stage with no matching section', () => {
    const md = `---
name: x
description: d
stages: [intake, final-review]
---
## intake
hi
`;
    expect(() => parseSkillMarkdown('x', md)).toThrow(/failed validation/);
  });

  it('rejects a name that does not match the directory', () => {
    expect(() => parseSkillMarkdown('other', GOOD)).toThrow(/mismatched internal name/);
  });

  it('requires a description', () => {
    const md = `---
name: x
stages: [intake]
---
## intake
hi
`;
    expect(() => parseSkillMarkdown('x', md)).toThrow(/missing a "description"/);
  });
});

describe('blankSkillMarkdown', () => {
  it('produces a scaffold that parses and validates', () => {
    const md = blankSkillMarkdown('my-skill');
    const spec = parseSkillMarkdown('my-skill', md);
    expect(spec.name).toBe('my-skill');
    expect(spec.stages).toEqual([...SKILL_STAGES]);
    for (const stage of SKILL_STAGES) {
      expect(spec.instructions[stage]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('ignores HTML comments in the body (they are not stage sections)', () => {
    const spec = parseSkillMarkdown('my-skill', blankSkillMarkdown('my-skill'));
    expect(spec.instructions.intake).not.toContain('<!--');
  });
});
