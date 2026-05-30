import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { blankSkillMarkdown } from '../../skill/spec.js';
import { slugify } from '../../store/paths.js';
import { SkillExistsError, saveSkill, skillExists } from '../../store/skills.js';

export default class SkillCreate extends BaseCommand {
  static override description =
    'Create a new skill by writing an annotated SKILL.md scaffold to ~/.deckpilot/skills/<name>/. The scaffold documents the format (frontmatter + intake / slide-check / final-review stages); edit it with `deckpilot skill edit <name>`.';

  static override examples = [
    '<%= config.bin %> skill create exec-review',
    '<%= config.bin %> skill create exec-review --overwrite',
  ];

  static override args = {
    name: Args.string({
      required: true,
      description: 'Skill name (becomes the directory name; lower-case kebab).',
    }),
  };

  static override flags = {
    overwrite: Flags.boolean({
      description: 'Replace an existing skill of the same name.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillCreate);
    const name = slugify(args.name);
    if (!name) {
      this.fail(`"${args.name}" has no usable characters for a skill name. Use lower-case kebab.`);
    }

    if (!flags.overwrite && (await skillExists(name))) {
      this.fail(
        `A skill named "${name}" already exists. Pass --overwrite to replace it, or pick another name.`,
      );
    }

    try {
      const { rootDir } = await saveSkill(name, blankSkillMarkdown(name), {
        overwrite: flags.overwrite,
      });
      this.log(`Created skill "${name}" at ${rootDir}/SKILL.md.`);
      this.log(`Next: deckpilot skill edit ${name}   # open it in your $EDITOR`);
    } catch (e) {
      if (e instanceof SkillExistsError) this.fail(e.message);
      throw e;
    }
  }
}
