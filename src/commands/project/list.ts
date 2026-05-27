import { BaseCommand } from '../../cli/base-command.js';
import { projectsRoot } from '../../store/paths.js';
import { listProjects } from '../../store/projects.js';

export default class ProjectList extends BaseCommand {
  static override description =
    'List all DeckPilot projects saved under ~/.deckpilot/projects/, most-recently-updated first.';

  static override examples = ['<%= config.bin %> project list'];

  async run(): Promise<void> {
    const entries = await listProjects();
    if (entries.length === 0) {
      this.log(`No projects yet under ${projectsRoot()}.`);
      this.log('Start one with: deckpilot chat <name>   (or just `deckpilot chat` for project-N).');
      return;
    }
    this.log(`Projects (${entries.length}):`);
    for (const e of entries) {
      const m = e.manifest;
      const tpl = m.templateName ? ` · template: ${m.templateName}` : '';
      const session = m.sessionId ? '' : '  (no LLM session yet)';
      this.log(
        `  ${m.name.padEnd(28)}  updated ${m.updatedAt.slice(0, 19).replace('T', ' ')}${tpl}${session}`,
      );
    }
  }
}
