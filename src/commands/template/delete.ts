import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { deleteTemplate, TemplateNotFoundError } from '../../store/templates.js';

export default class TemplateDelete extends BaseCommand {
  static override description = 'Delete a saved DeckPilot template (and its assets directory).';

  static override examples = ['<%= config.bin %> template delete acme-corp --yes'];

  static override args = {
    name: Args.string({ required: true, description: 'Template name to delete.' }),
  };

  static override flags = {
    yes: Flags.boolean({ description: 'Confirm the deletion (required — there is no undo).', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateDelete);
    if (!flags.yes) {
      this.fail(`Refusing to delete "${args.name}" without --yes. There is no undo.`);
    }
    try {
      await deleteTemplate(args.name);
      this.log(`Deleted template "${args.name}".`);
    } catch (e) {
      if (e instanceof TemplateNotFoundError) this.fail(e.message);
      throw e;
    }
  }
}
