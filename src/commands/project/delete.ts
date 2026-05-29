import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { ProjectNotFoundError, deleteProject } from '../../store/projects.js';

export default class ProjectDelete extends BaseCommand {
  static override description =
    'Delete one or more saved projects (brief, slide code, transcript, manifest). Pass several names to delete in bulk in a single command — useful for scripted cleanup.';

  static override examples = [
    '<%= config.bin %> project delete old-draft --yes',
    '<%= config.bin %> project delete draft-1 draft-2 draft-3 --yes',
  ];

  // Allow variadic positional args via strict: false. The first positional is
  // declared on `args.name`; everything else comes through `argv`.
  static override strict = false;

  static override args = {
    name: Args.string({ required: true, description: 'Project name to delete.' }),
  };

  static override flags = {
    yes: Flags.boolean({
      description: 'Confirm the deletion (required — there is no undo).',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ProjectDelete);
    const names = (argv as unknown[]).filter((a): a is string => typeof a === 'string');
    if (names.length === 0) {
      this.fail('At least one project name is required.');
    }
    if (!flags.yes) {
      this.fail(
        `Refusing to delete ${names.length === 1 ? `"${names[0]}"` : `${names.length} projects`} without --yes. There is no undo.`,
      );
    }

    const deleted: string[] = [];
    const failures: { name: string; reason: string }[] = [];
    for (const name of names) {
      try {
        await deleteProject(name);
        deleted.push(name);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        failures.push({ name, reason });
        if (!(e instanceof ProjectNotFoundError) && !(e instanceof Error)) throw e;
      }
    }

    if (deleted.length > 0) {
      this.log(
        deleted.length === 1
          ? `Deleted project "${deleted[0]}".`
          : `Deleted ${deleted.length} projects: ${deleted.join(', ')}.`,
      );
    }
    for (const f of failures) this.log(`  ! ${f.name}: ${f.reason}`);
    if (failures.length > 0) this.error('Some projects could not be deleted.', { exit: 1 });
  }
}
