import { readFile } from 'node:fs/promises';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../cli/base-command.js';
import { renderPlan } from '../render/renderer.js';
import { SlidePlanSchema, formatZodError } from '../deck/schema.js';

export default class Render extends BaseCommand {
  static override description =
    'Render a SlidePlan JSON file to .pptx without the chat loop. Useful for CI, regression tests, or re-rendering a previously-saved plan.';

  static override examples = [
    '<%= config.bin %> render plan.json',
    '<%= config.bin %> render plan.json --out deck.pptx',
  ];

  static override args = {
    planFile: Args.string({
      name: 'planFile',
      required: true,
      description: 'Path to a SlidePlan JSON file (typically produced by /save or save_deck).',
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
      raw = await readFile(args.planFile, 'utf8');
    } catch (e) {
      this.fail(`Could not read ${args.planFile}: ${(e as Error).message}`);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (e) {
      this.fail(`${args.planFile} is not valid JSON: ${(e as Error).message}`);
    }
    const result = SlidePlanSchema.safeParse(parsedJson);
    if (!result.success) {
      this.fail(`SlidePlan validation failed:\n${formatZodError(result.error)}`);
    }
    const plan = result.data;
    const out =
      flags.out ??
      `${
        plan.meta.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'deckpilot-output'
      }.pptx`;
    const abs = await renderPlan(plan, out);
    this.log(`Wrote ${plan.slides.length}-slide deck → ${abs}`);
  }
}
