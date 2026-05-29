import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { TemplateNotFoundError, loadTemplate } from '../../store/templates.js';

export default class TemplateShow extends BaseCommand {
  static override description = 'Show the full TemplateSpec for a saved template.';

  static override examples = ['<%= config.bin %> template show acme-corp'];

  static override args = {
    name: Args.string({
      required: true,
      description: 'Template name (directory under ~/.deckpilot/templates/).',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TemplateShow);
    try {
      const tpl = await loadTemplate(args.name);
      this.log(`Template "${tpl.name}"  (${tpl.rootDir})`);
      this.log(
        JSON.stringify(
          {
            schemaVersion: tpl.schemaVersion,
            name: tpl.name,
            description: tpl.description,
            brand: tpl.brand,
            theme: tpl.theme,
            assets: tpl.assets,
            voiceHints: tpl.voiceHints,
            copyRules: tpl.copyRules,
            guidance: tpl.guidance,
            master: tpl.master,
            paletteSamples: tpl.paletteSamples,
            donorGeometry: tpl.donorGeometry,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      if (e instanceof TemplateNotFoundError) this.fail(e.message);
      throw e;
    }
  }
}
