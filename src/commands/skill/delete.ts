import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { BuiltinSkillError, SkillNotFoundError, deleteSkill } from '../../store/skills.js';

export default class SkillDelete extends BaseCommand {
  static override description =
    'Delete one or more of your saved skills. Pass several names to delete in bulk. Built-in skills cannot be deleted.';

  static override examples = [
    '<%= config.bin %> skill delete exec-review --yes',
    '<%= config.bin %> skill delete draft-a draft-b --yes',
  ];

  static override strict = false;

  static override args = {
    name: Args.string({ required: true, description: 'Skill name to delete.' }),
  };

  static override flags = {
    yes: Flags.boolean({
      description: 'Confirm the deletion (required — there is no undo).',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(SkillDelete);
    const names = (argv as unknown[]).filter((a): a is string => typeof a === 'string');
    if (names.length === 0) {
      this.fail('At least one skill name is required.');
    }
    if (!flags.yes) {
      this.fail(
        `Refusing to delete ${names.length === 1 ? `"${names[0]}"` : `${names.length} skills`} without --yes. There is no undo.`,
      );
    }

    const deleted: string[] = [];
    const failures: { name: string; reason: string }[] = [];
    for (const name of names) {
      try {
        await deleteSkill(name);
        deleted.push(name);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        failures.push({ name, reason });
        if (
          !(e instanceof SkillNotFoundError) &&
          !(e instanceof BuiltinSkillError) &&
          !(e instanceof Error)
        ) {
          throw e;
        }
      }
    }

    if (deleted.length > 0) {
      this.log(
        deleted.length === 1
          ? `Deleted skill "${deleted[0]}".`
          : `Deleted ${deleted.length} skills: ${deleted.join(', ')}.`,
      );
    }
    for (const f of failures) this.log(`  ! ${f.name}: ${f.reason}`);
    if (failures.length > 0) this.error('Some skills could not be deleted.', { exit: 1 });
  }
}
