import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { ProjectExistsError, ProjectNotFoundError, renameProject } from '../../store/projects.js';

export default class ProjectRename extends BaseCommand {
  static override description =
    "Rename a saved project — moves ~/.deckpilot/projects/<old>/ to <new>/ and updates the manifest's name. The Copilot session ID is preserved, so an LLM session resumes seamlessly under the new name.";

  static override examples = ['<%= config.bin %> project rename my-pitch q4-pitch'];

  static override args = {
    from: Args.string({ required: true, description: 'Current project name.' }),
    to: Args.string({ required: true, description: 'New project name (lower-case kebab).' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectRename);
    try {
      await renameProject(args.from, args.to);
      this.log(`Renamed "${args.from}" → "${args.to}".`);
    } catch (e) {
      if (e instanceof ProjectNotFoundError || e instanceof ProjectExistsError) {
        this.fail(e.message);
      }
      this.handle(e);
    }
  }
}
