import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../cli/base-command.js';
import { DeckBriefSchema, formatZodError } from '../deck/brief.js';
import { renderDeck } from '../render/renderer.js';

export default class Render extends BaseCommand {
  static override description =
    'Render a DeckBrief JSON file (with sibling per-slide .ts source files) to .pptx without the chat loop. Useful for CI, regression tests, or re-rendering a previously-saved deck.';

  static override examples = [
    '<%= config.bin %> render deck.brief.json',
    '<%= config.bin %> render deck.brief.json --out deck.pptx',
  ];

  static override args = {
    briefFile: Args.string({
      name: 'briefFile',
      required: true,
      description:
        'Path to a DeckBrief JSON file (typically <output>.brief.json produced by /save or save_deck).',
    }),
  };

  static override flags = {
    out: Flags.string({
      description: 'Output .pptx path (default: derived from the deck title).',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Render);
    let raw: string;
    try {
      raw = await readFile(args.briefFile, 'utf8');
    } catch (e) {
      this.fail(`Could not read ${args.briefFile}: ${(e as Error).message}`);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (e) {
      this.fail(`${args.briefFile} is not valid JSON: ${(e as Error).message}`);
    }
    const result = DeckBriefSchema.safeParse(parsedJson);
    if (!result.success) {
      this.fail(`DeckBrief validation failed:\n${formatZodError(result.error)}`);
    }
    const brief = result.data;

    // Look for sibling slide source files: <briefBase>.<slideId>.slide.ts.
    const briefPath = resolve(process.cwd(), args.briefFile);
    const baseName = basename(briefPath).replace(/\.brief\.json$/i, '');
    const siblingDir = dirname(briefPath);
    const slideCode = new Map<string, string>();
    for (const slide of brief.slides) {
      const sp = resolve(siblingDir, `${baseName}.${slide.id}.slide.ts`);
      try {
        const code = await readFile(sp, 'utf8');
        slideCode.set(slide.id, code);
      } catch {
        // Missing slide file — the renderer will emit a placeholder for it.
      }
    }

    const out =
      flags.out ??
      `${
        brief.meta.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'deckpilot-output'
      }.pptx`;
    const abs = await renderDeck(brief, slideCode, out);
    const missing = brief.slides.length - slideCode.size;
    const suffix =
      missing > 0
        ? ` (${missing} placeholder slide${missing === 1 ? '' : 's'} — no .slide.ts files found)`
        : '';
    this.log(`Wrote ${brief.slides.length}-slide deck → ${abs}${suffix}`);
  }
}
