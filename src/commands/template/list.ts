import { BaseCommand } from '../../cli/base-command.js';
import { listTemplates } from '../../store/templates.js';
import { summarizeTemplate } from '../../template/spec.js';
import { templatesRoot } from '../../store/paths.js';

export default class TemplateList extends BaseCommand {
  static override description = 'List all DeckPilot templates saved under ~/.deckpilot/templates/.';

  static override examples = ['<%= config.bin %> template list'];

  async run(): Promise<void> {
    const entries = await listTemplates();
    if (entries.length === 0) {
      this.log(`No templates saved yet under ${templatesRoot()}.`);
      this.log('Create one with:');
      this.log('  deckpilot template create <name>            # blank scaffold to edit');
      this.log('  deckpilot template create <name> --from <.pptx>  # extract from a deck');
      return;
    }
    this.log(`Templates (${entries.length}):`);
    for (const e of entries) {
      this.log(`  ${summarizeTemplate(e.spec)}`);
    }
  }
}
