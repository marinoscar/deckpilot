import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { ProjectNotFoundError, loadProject } from '../../store/projects.js';

export default class ProjectShow extends BaseCommand {
  static override description = 'Show the manifest + brief summary of a saved project.';

  static override examples = ['<%= config.bin %> project show acme-pitch'];

  static override args = {
    name: Args.string({ required: true, description: 'Project name.' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectShow);
    try {
      const p = await loadProject(args.name);
      this.log(`Project "${p.manifest.name}"  (${p.rootDir})`);
      this.log(`  created:        ${p.manifest.createdAt}`);
      this.log(`  updated:        ${p.manifest.updatedAt}`);
      this.log(`  template:       ${p.manifest.templateName ?? '(none)'}`);
      this.log(`  model:          ${p.manifest.model ?? '(default)'}`);
      this.log(`  session id:     ${p.manifest.sessionId ?? '(none yet)'}`);
      this.log(`  critique cap:   ${p.manifest.critiquePassesPerSlide}`);
      this.log(
        `  brief:          ${p.brief ? `${p.brief.slides.length} slides — "${p.brief.meta.title}"` : '(none)'}`,
      );
      this.log(`  slide code:     ${p.slideCode.size} file${p.slideCode.size === 1 ? '' : 's'}`);
      this.log(
        `  transcript:     ${p.transcript.length} entr${p.transcript.length === 1 ? 'y' : 'ies'}`,
      );
    } catch (e) {
      if (e instanceof ProjectNotFoundError) this.fail(e.message);
      throw e;
    }
  }
}
