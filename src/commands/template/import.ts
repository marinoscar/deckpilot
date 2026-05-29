import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { templateDir } from '../../store/paths.js';
import {
  TemplateExistsError,
  loadTemplate,
  saveTemplate,
  templateExists,
} from '../../store/templates.js';
import { TemplateSpecSchema, formatZodError } from '../../template/spec.js';
import { readZipEntry, unpackZip } from '../../util/zip.js';

export default class TemplateImport extends BaseCommand {
  static override description =
    'Import a template from a zip archive (produced by `deckpilot template export` or shared by a teammate). Pass --name to rename on import — useful when you already have a template of the same name.';

  static override examples = [
    '<%= config.bin %> template import ./acme.zip',
    '<%= config.bin %> template import ./acme.zip --name acme-fork',
  ];

  static override args = {
    archive: Args.string({ required: true, description: 'Path to the .zip archive.' }),
  };

  static override flags = {
    name: Flags.string({
      description:
        "Override the template name on import. Defaults to the spec's own `name` field inside the archive.",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplateImport);
    if (!existsSync(args.archive)) {
      this.fail(`Zip file not found: ${args.archive}.`);
    }

    // Step 1: peek inside the zip for template.json to discover the spec name.
    let bytes: Buffer | null;
    try {
      bytes = await readZipEntry(args.archive, 'template.json');
    } catch (e) {
      this.fail(`Could not read archive: ${(e as Error).message}`);
    }
    if (!bytes) {
      this.fail(
        'Archive does not contain a top-level template.json. Are you sure it was produced by `deckpilot template export`?',
      );
    }
    let specInZip: unknown;
    try {
      specInZip = JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      this.fail(`Embedded template.json is not valid JSON: ${(e as Error).message}`);
    }
    const validated = TemplateSpecSchema.safeParse(specInZip);
    if (!validated.success) {
      this.fail(`Embedded template.json failed validation:\n${formatZodError(validated.error)}`);
    }
    const finalName = flags.name ?? validated.data.name;

    // Step 2: rename-on-import? Patch the spec in-memory first, then extract
    // the assets into a tmp dir and save the patched spec on top.
    if (!/^[a-z0-9-]+$/.test(finalName)) {
      this.fail(`Bad template name "${finalName}". Use lower-case kebab.`);
    }
    if (await templateExists(finalName)) {
      this.fail(new TemplateExistsError(finalName).message);
    }

    const tmp = await mkdtemp(join(tmpdir(), 'deckpilot-import-'));
    try {
      await unpackZip(args.archive, tmp);

      // Re-validate the embedded JSON after extract (paranoia: extract and
      // disk read must agree).
      const dest = templateDir(finalName);
      // Move the unpacked tree to the dest dir. We do this by saving the spec
      // (which mkdir's dest and writes template.json) and then copying assets
      // over.
      const patchedSpec = { ...validated.data, name: finalName };
      await saveTemplate(patchedSpec, { overwrite: false });

      // Copy any assets/ files from tmp into dest/assets/.
      const { copyFile, mkdir, readdir, stat } = await import('node:fs/promises');
      const assetsSrc = join(tmp, 'assets');
      if (existsSync(assetsSrc)) {
        const assetsDest = join(dest, 'assets');
        await mkdir(assetsDest, { recursive: true });
        for (const entry of await readdir(assetsSrc)) {
          const srcPath = join(assetsSrc, entry);
          const destPath = join(assetsDest, entry);
          const st = await stat(srcPath);
          if (st.isFile()) await copyFile(srcPath, destPath);
        }
      }

      const loaded = await loadTemplate(finalName);
      this.log(`Imported template "${finalName}" → ${loaded.rootDir}`);
    } catch (e) {
      this.fail(`Import failed: ${(e as Error).message}`);
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
}
