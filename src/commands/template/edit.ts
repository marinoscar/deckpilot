import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { templateDir } from '../../store/paths.js';
import { TemplateNotFoundError, loadTemplate, saveTemplate } from '../../store/templates.js';
import { TemplateSpecSchema, formatZodError } from '../../template/spec.js';
import { editInExternal } from '../../util/external-editor.js';
import { TemplatePatchError, applyPatches } from '../../util/template-patch.js';

export default class TemplateEdit extends BaseCommand {
  static override description =
    'Edit a saved template. Either patch individual fields with --set key=value (non-interactive, scriptable) or pop out to $EDITOR with --editor for free-form edits on template.json. Without flags, --editor is implied. Settable keys: brand, description, voiceHints, copyRules, guidance, theme.accent / accentAlt / ink / muted / paper / fontHeading / fontBody / tone / aspect, assets.logo / wordmark / background.';

  static override examples = [
    "<%= config.bin %> template edit acme --set brand='Acme Corp'",
    '<%= config.bin %> template edit acme --set theme.accent=1A2B5E --set theme.tone=corporate',
    '<%= config.bin %> template edit acme --editor',
    '<%= config.bin %> template edit acme  # opens $EDITOR by default',
  ];

  static override strict = false; // allow repeated --set values

  static override args = {
    name: Args.string({ required: true, description: 'Template name.' }),
  };

  static override flags = {
    set: Flags.string({
      description: "Patch one field, e.g. --set 'brand=Acme Corp'. Repeatable.",
      multiple: true,
    }),
    editor: Flags.boolean({
      description: 'Open template.json in $EDITOR for free-form edits.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateEdit);
    const patches = flags.set ?? [];

    try {
      const current = await loadTemplate(args.name);
      // ResolvedTemplate has assets as absolute paths; for editing/saving we
      // need the on-disk JSON shape (relative paths). Re-read the raw spec.
      const file = join(templateDir(args.name), 'template.json');
      const raw = await readFile(file, 'utf8');
      const parsed = TemplateSpecSchema.parse(JSON.parse(raw));

      // Branch 1: --set patches (preferred for scripting).
      if (patches.length > 0 && !flags.editor) {
        try {
          const next = applyPatches(parsed, patches);
          await saveTemplate(next, { overwrite: true });
          this.log(
            `Updated template "${args.name}" (${patches.length} patch${patches.length === 1 ? '' : 'es'}).`,
          );
          return;
        } catch (e) {
          if (e instanceof TemplatePatchError) this.fail(e.message);
          throw e;
        }
      }

      // Branch 2: open in $EDITOR (also fallback when no --set was passed).
      const initial = `${JSON.stringify(parsed, null, 2)}\n`;
      const after = await editInExternal({
        initialText: initial,
        extension: '.json',
      });
      if (after.trim() === '') {
        this.fail('Editor returned empty text; aborting.');
      }
      let edited: unknown;
      try {
        edited = JSON.parse(after);
      } catch (e) {
        this.fail(`Edited template.json is not valid JSON: ${(e as Error).message}`);
      }
      const result = TemplateSpecSchema.safeParse(edited);
      if (!result.success) {
        this.fail(`Validation failed after edit:\n${formatZodError(result.error)}`);
      }
      if (result.data.name !== current.name) {
        this.fail(
          `Cannot rename a template by editing its JSON. Got "${result.data.name}"; expected "${current.name}".`,
        );
      }
      await saveTemplate(result.data, { overwrite: true });
      this.log(`Updated template "${args.name}".`);

      // For visibility on Windows where notepad doesn't echo to stdout,
      // dump the resulting JSON path so the user can sanity-check.
      if (existsSync(file)) {
        await writeFile(file, `${JSON.stringify(result.data, null, 2)}\n`);
      }
    } catch (e) {
      if (e instanceof TemplateNotFoundError) this.fail(e.message);
      this.handle(e);
    }
  }
}
