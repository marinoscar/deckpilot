import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { parseSkillMarkdown } from '../../skill/spec.js';
import { skillDir } from '../../store/paths.js';
import { SkillNotFoundError, isBuiltinSkill, loadSkill, saveSkill } from '../../store/skills.js';
import { editInExternal } from '../../util/external-editor.js';

export default class SkillEdit extends BaseCommand {
  static override description =
    "Open a skill's SKILL.md in $EDITOR for free-form edits, then re-validate it. Built-in skills are read-only — copy one with `skill create` to customize it.";

  static override examples = ['<%= config.bin %> skill edit exec-review'];

  static override args = {
    name: Args.string({ required: true, description: 'Skill name.' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillEdit);
    const name = args.name;

    try {
      // Confirms existence (built-in or user).
      await loadSkill(name);
    } catch (e) {
      if (e instanceof SkillNotFoundError) this.fail(e.message);
      throw e;
    }

    if (await isBuiltinSkill(name)) {
      this.fail(
        `"${name}" is a built-in skill and can't be edited. Copy it first: deckpilot skill create ${name}-custom, then paste and adjust.`,
      );
    }

    const file = join(skillDir(name), 'SKILL.md');
    const initial = await readFile(file, 'utf8');
    const after = await editInExternal({ initialText: initial, extension: '.md' });
    if (after.trim() === '') {
      this.fail('Editor returned empty text; aborting (the existing SKILL.md is unchanged).');
    }

    // Validate before persisting so a typo doesn't leave a broken skill.
    try {
      parseSkillMarkdown(name, after);
    } catch (e) {
      this.fail(`${(e as Error).message}\n\nYour edit was NOT saved. Re-run and fix the issues.`);
    }

    await saveSkill(name, after, { overwrite: true });
    this.log(`Updated skill "${name}".`);
  }
}
