import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { ProjectNotFoundError, deleteProject } from '../../store/projects.js';

export default class ProjectDelete extends BaseCommand {
  static override description = 'Delete a saved project (brief, slide code, transcript, manifest).';

  static override examples = ['<%= config.bin %> project delete old-draft --yes'];

  static override args = {
    name: Args.string({ required: true, description: 'Project name.' }),
  };

  static override flags = {
    yes: Flags.boolean({
      description: 'Confirm the deletion (required — there is no undo).',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectDelete);
    if (!flags.yes) {
      this.fail(`Refusing to delete "${args.name}" without --yes. There is no undo.`);
    }
    try {
      await deleteProject(args.name);
      this.log(`Deleted project "${args.name}".`);
    } catch (e) {
      if (e instanceof ProjectNotFoundError) this.fail(e.message);
      throw e;
    }
  }
}
