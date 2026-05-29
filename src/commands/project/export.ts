import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { projectDir } from '../../store/paths.js';
import { ProjectNotFoundError, projectExists } from '../../store/projects.js';
import { packDirectory } from '../../util/zip.js';

export default class ProjectExport extends BaseCommand {
  static override description =
    'Pack a saved project (brief, slide code, transcript, previews, manifest) into a portable .zip — useful for archiving a finished deck, sharing a work-in-progress with a teammate, or moving a project between machines.';

  static override examples = [
    '<%= config.bin %> project export my-pitch              # writes ./my-pitch.zip',
    '<%= config.bin %> project export my-pitch ./archive/my-pitch.zip',
  ];

  static override args = {
    name: Args.string({ required: true, description: 'Project name to export.' }),
    output: Args.string({
      required: false,
      description: 'Output .zip path. Defaults to ./<name>.zip in the cwd.',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectExport);
    if (!(await projectExists(args.name))) {
      this.fail(new ProjectNotFoundError(args.name).message);
    }
    const src = projectDir(args.name);
    const out = resolve(args.output ?? `./${args.name}.zip`);
    if (existsSync(out)) {
      this.fail(`Output file already exists: ${out}. Pick another path or delete it first.`);
    }
    try {
      await packDirectory(src, out);
      this.log(`Exported "${args.name}" to ${out}.`);
    } catch (e) {
      this.fail(`Export failed: ${(e as Error).message}`);
    }
  }
}
