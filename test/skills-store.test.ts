import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankSkillMarkdown } from '../src/skill/spec.js';
import { skillDir } from '../src/store/paths.js';
import {
  BuiltinSkillError,
  SkillExistsError,
  SkillNotFoundError,
  deleteSkill,
  isBuiltinSkill,
  listSkills,
  loadSkill,
  saveSkill,
  skillExists,
} from '../src/store/skills.js';

describe('skills store', () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'deckpilot-skills-'));
    process.env.DECKPILOT_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.DECKPILOT_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('saveSkill writes SKILL.md and round-trips through loadSkill', async () => {
    const { rootDir } = await saveSkill('demo', blankSkillMarkdown('demo'));
    expect(existsSync(join(rootDir, 'SKILL.md'))).toBe(true);
    const loaded = await loadSkill('demo');
    expect(loaded.name).toBe('demo');
    expect(loaded.builtin).toBe(false);
    expect(loaded.stages.length).toBeGreaterThan(0);
  });

  it('saveSkill refuses to overwrite without the flag, allows it with', async () => {
    await saveSkill('demo', blankSkillMarkdown('demo'));
    await expect(saveSkill('demo', blankSkillMarkdown('demo'))).rejects.toBeInstanceOf(
      SkillExistsError,
    );
    await expect(
      saveSkill('demo', blankSkillMarkdown('demo'), { overwrite: true }),
    ).resolves.toBeTruthy();
  });

  it('saveSkill rejects invalid markdown before touching disk', async () => {
    await expect(saveSkill('demo', 'no frontmatter here')).rejects.toThrow();
    expect(existsSync(join(skillDir('demo'), 'SKILL.md'))).toBe(false);
  });

  it('listSkills includes the bundled story-arc built-in', async () => {
    const list = await listSkills();
    const storyArc = list.find((e) => e.name === 'story-arc');
    expect(storyArc).toBeDefined();
    expect(storyArc?.builtin).toBe(true);
    expect(storyArc?.spec.stages).toEqual(['intake', 'slide-check', 'final-review']);
  });

  it('a user skill shadows a built-in of the same name', async () => {
    await saveSkill('story-arc', blankSkillMarkdown('story-arc'));
    const list = await listSkills();
    const entries = list.filter((e) => e.name === 'story-arc');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.builtin).toBe(false);
    const loaded = await loadSkill('story-arc');
    expect(loaded.builtin).toBe(false);
  });

  it('deleteSkill removes a user skill', async () => {
    await saveSkill('demo', blankSkillMarkdown('demo'));
    await deleteSkill('demo');
    expect(await skillExists('demo')).toBe(false);
  });

  it('deleteSkill refuses a built-in', async () => {
    await expect(deleteSkill('story-arc')).rejects.toBeInstanceOf(BuiltinSkillError);
  });

  it('deleteSkill throws SkillNotFoundError for an unknown name', async () => {
    await expect(deleteSkill('nope')).rejects.toBeInstanceOf(SkillNotFoundError);
  });

  it('skillExists and isBuiltinSkill report correctly', async () => {
    expect(await skillExists('story-arc')).toBe(true);
    expect(await isBuiltinSkill('story-arc')).toBe(true);
    await saveSkill('demo', blankSkillMarkdown('demo'));
    expect(await isBuiltinSkill('demo')).toBe(false);
    expect(await isBuiltinSkill('nope')).toBe(false);
  });
});
