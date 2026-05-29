import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { TemplateNotFoundError, deleteTemplate } from '../../store/templates.js';

export default class TemplateDelete extends BaseCommand {
  static override description =
    'Delete one or more saved DeckPilot templates (and each assets directory). Pass several names to delete in bulk in a single command.';

  static override examples = [
    '<%= config.bin %> template delete acme-corp --yes',
    '<%= config.bin %> template delete proto-a proto-b proto-c --yes',
  ];

  static override strict = false;

  static override args = {
    name: Args.string({ required: true, description: 'Template name to delete.' }),
  };

  static override flags = {
    yes: Flags.boolean({
      description: 'Confirm the deletion (required — there is no undo).',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(TemplateDelete);
    const names = (argv as unknown[]).filter((a): a is string => typeof a === 'string');
    if (names.length === 0) {
      this.fail('At least one template name is required.');
    }
    if (!flags.yes) {
      this.fail(
        `Refusing to delete ${names.length === 1 ? `"${names[0]}"` : `${names.length} templates`} without --yes. There is no undo.`,
      );
    }

    const deleted: string[] = [];
    const failures: { name: string; reason: string }[] = [];
    for (const name of names) {
      try {
        await deleteTemplate(name);
        deleted.push(name);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        failures.push({ name, reason });
        if (!(e instanceof TemplateNotFoundError) && !(e instanceof Error)) throw e;
      }
    }

    if (deleted.length > 0) {
      this.log(
        deleted.length === 1
          ? `Deleted template "${deleted[0]}".`
          : `Deleted ${deleted.length} templates: ${deleted.join(', ')}.`,
      );
    }
    for (const f of failures) this.log(`  ! ${f.name}: ${f.reason}`);
    if (failures.length > 0) this.error('Some templates could not be deleted.', { exit: 1 });
  }
}
