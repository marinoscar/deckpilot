import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { slugify, templateDir } from '../../store/paths.js';
import { saveTemplate, templateExists } from '../../store/templates.js';
import { extractTemplateFromPptx } from '../../template/extract-from-pptx.js';
import { templateFromPptx } from '../../template/from-pptx.js';
import { blankTemplate } from '../../template/spec.js';

export default class TemplateCreate extends BaseCommand {
  static override description =
    'Create a new DeckPilot template. With --from <pptx> the LLM examines the rendered slides (vision-driven) to author a rich TemplateSpec; --shallow keeps the older palette-only OOXML extractor. Without --from, a blank scaffold is created for you to edit.';

  static override examples = [
    '<%= config.bin %> template create acme-corp --from ./brand.pptx',
    '<%= config.bin %> template create acme-corp --from ./brand.pptx --shallow',
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
      description:
        'Path to a .pptx to extract from. Default uses LLM vision; pair with --shallow for palette-only OOXML.',
      required: false,
    }),
    shallow: Flags.boolean({
      description:
        'When set with --from, skip the LLM vision pass and use only the OOXML theme (faster, palette-only).',
      default: false,
    }),
    brand: Flags.string({
      description: 'Optional brand name to embed in the spec.',
      required: false,
    }),
    description: Flags.string({
      description: 'Optional one-line description embedded in the spec.',
      required: false,
    }),
    overwrite: Flags.boolean({
      description:
        'Overwrite an existing template.json with the same name. Asset files in assets/ are left alone.',
      default: false,
    }),
    model: Flags.string({
      description:
        'LLM model for the vision pass (only used with --from without --shallow). Falls back to the Copilot CLI default.',
      required: false,
    }),
    token: Flags.string({
      description: 'GitHub token for the Copilot SDK (vision pass only).',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    'max-slides': Flags.integer({
      description: 'Cap on slides sent to the LLM in the vision pass. Default 20.',
      required: false,
      default: 20,
      min: 1,
      max: 60,
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

    // ---- No source pptx → blank scaffold ----
    if (!flags.from) {
      const spec = {
        ...blankTemplate(slug),
        ...(flags.brand ? { brand: flags.brand } : {}),
        ...(flags.description ? { description: flags.description } : {}),
      };
      const { rootDir } = await saveTemplate(spec, { overwrite: flags.overwrite });
      this.log(`Created template "${slug}" at ${rootDir}`);
      this.log('  template.json  · the spec (edit by hand to add voiceHints, copyRules, guidance)');
      this.log(
        '  assets/        · drop logo.png / wordmark.svg here and reference them in template.json',
      );
      return;
    }

    // ---- Source pptx + --shallow → OOXML-only, no LLM ----
    if (flags.shallow) {
      const spec = await templateFromPptx(slug, flags.from, {
        brand: flags.brand,
        description: flags.description,
      });
      const { rootDir } = await saveTemplate(spec, { overwrite: flags.overwrite });
      this.log(`✓ Saved template "${slug}" (shallow) to ${rootDir}`);
      this.log('  The OOXML-only path leaves voice/copy/guidance blank for you to fill in.');
      return;
    }

    // ---- Source pptx + vision pass (default) ----
    this.log(`Extracting "${slug}" from ${flags.from} …`);
    const result = await extractTemplateFromPptx({
      name: slug,
      pptxPath: flags.from,
      brand: flags.brand,
      description: flags.description,
      overwrite: flags.overwrite,
      model: flags.model,
      token: flags.token,
      maxSlides: flags['max-slides'],
      onProgress: (e) => this.printProgress(e),
    });

    if (result.vision) {
      this.log(`✓ Saved template "${slug}" to ${result.savedPath}`);
      this.log(
        `  Inspect with: deckpilot template show ${slug}` +
          `\n  Then drop your logo into ${result.savedPath}/assets/ and reference it in template.json.`,
      );
    } else {
      this.log(`✓ Saved template "${slug}" (shallow fallback) to ${result.savedPath}`);
      this.log('  The vision pass was skipped; voice/copy/guidance are blank for you to fill in.');
    }
  }

  /** Pretty-print extraction progress events to stdout/stderr. */
  private printProgress(e: import('../../template/extract-from-pptx.js').ExtractEvent): void {
    switch (e.kind) {
      case 'libreoffice':
        if (!e.available) {
          this.warn('LibreOffice not found on PATH — falling back to shallow OOXML extraction.');
          this.warn('  Install with: sudo apt install libreoffice poppler-utils  (Ubuntu/WSL)');
          this.warn(
            '              brew install --cask libreoffice && brew install poppler  (macOS)',
          );
        }
        return;
      case 'session-started':
        this.log(`✓ Started extraction session${e.model ? ` (${e.model})` : ''}`);
        return;
      case 'tool-start':
        this.log(`… ${e.name} …`);
        return;
      case 'tool-complete':
        this.log(`${e.ok ? '✓' : '✗'} ${e.name}`);
        return;
      case 'fallback':
        this.warn(`Falling back to shallow extraction: ${e.reason}`);
        return;
      case 'saved':
        // Final "saved" line is printed by the caller after the result resolves.
        return;
    }
  }
}
