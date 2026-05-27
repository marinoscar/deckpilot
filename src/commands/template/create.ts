import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { templateDir } from '../../store/paths.js';
import { slugify } from '../../store/paths.js';
import { saveTemplate, templateExists } from '../../store/templates.js';
import { templateFromPptx } from '../../template/from-pptx.js';
import { blankTemplate } from '../../template/spec.js';

export default class TemplateCreate extends BaseCommand {
  static override description =
    'Create a new DeckPilot template. With --from <pptx> the palette / fonts / aspect are extracted from the deck; otherwise a blank scaffold is created for you to edit.';

  static override examples = [
    '<%= config.bin %> template create acme-corp --from ./brand.pptx',
    '<%= config.bin %> template create personal',
  ];

  static override args = {
    name: Args.string({
      required: true,
      description: 'Template name (lower-case kebab; matches the directory).',
    }),
  };

  static override flags = {
    from: Flags.string({
      description: 'Path to a .pptx whose theme should be imported.',
      required: false,
    }),
    brand: Flags.string({
      description: 'Optional brand name to embed in the spec.',
      required: false,
    }),
    overwrite: Flags.boolean({
      description:
        'Overwrite an existing template.json with the same name. Asset files in assets/ are left alone.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateCreate);
    const slug = slugify(args.name);
    if (!slug || slug !== args.name) {
      this.fail(
        `Template names must be lower-case kebab (letters, digits, hyphens). Try: ${slug || '<your-name>'}`,
      );
    }
    if (!flags.overwrite && (await templateExists(slug))) {
      this.fail(
        `Template "${slug}" already exists at ${templateDir(slug)}. Pass --overwrite to replace it.`,
      );
    }

    const spec = flags.from
      ? await templateFromPptx(slug, flags.from, { brand: flags.brand })
      : { ...blankTemplate(slug), ...(flags.brand ? { brand: flags.brand } : {}) };

    const { rootDir } = await saveTemplate(spec, { overwrite: flags.overwrite });
    this.log(`Created template "${slug}" at ${rootDir}`);
    this.log('  template.json  · the spec (edit by hand to add voiceHints, copyRules, guidance)');
    this.log(
      '  assets/        · drop logo.png / wordmark.svg here and reference them in template.json',
    );
    if (flags.from) {
      this.log(`  Imported palette + fonts from ${flags.from}.`);
    }
  }
}
