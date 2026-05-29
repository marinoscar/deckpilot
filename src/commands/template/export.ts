import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { templateDir } from '../../store/paths.js';
import { TemplateNotFoundError, templateExists } from '../../store/templates.js';
import { packDirectory } from '../../util/zip.js';

export default class TemplateExport extends BaseCommand {
  static override description =
    'Pack a saved template (template.json + assets/) into a portable .zip you can share or check into version control. Round-trips with `deckpilot template import`.';

  static override examples = [
    '<%= config.bin %> template export acme              # writes ./acme.zip',
    '<%= config.bin %> template export acme ./shared/acme.zip',
  ];

  static override args = {
    name: Args.string({ required: true, description: 'Template name to export.' }),
    output: Args.string({
      required: false,
      description: 'Output .zip path. Defaults to ./<name>.zip in the cwd.',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TemplateExport);
    if (!(await templateExists(args.name))) {
      this.fail(new TemplateNotFoundError(args.name).message);
    }
    const src = templateDir(args.name);
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
