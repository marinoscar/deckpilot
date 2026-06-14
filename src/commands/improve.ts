import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import {
  IMPROVE_DOC_CHAR_BUDGET,
  IMPROVE_SEED_PROMPT,
  countPptxSlides,
  defaultImproveProjectName,
} from '../chat/improve.js';
import { ChatSession } from '../chat/session.js';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { loadConfig } from '../store/config.js';
import { TemplateNotFoundError, loadTemplate } from '../store/templates.js';
import { App } from '../ui/App.js';

/**
 * `deckpilot improve` — read an existing SOURCE deck, critique it, and rebuild
 * a markedly better version in a chosen brand TEMPLATE's style, then drop into
 * chat for adjustments. Composes the existing pipeline: the source is seeded as
 * content (text + a study_source_slides vision tool), a save_improvement_plan
 * tool persists the written plan, the named template supplies the style, and
 * the normal propose → approve → build → critique loop runs from there.
 *
 * The template is REQUIRED (the improved deck always adopts a deliberate brand
 * look); the skill is optional.
 */
export default class Improve extends BaseCommand {
  static override description =
    "Quality-check a deck: read it, plan improvements, and rebuild a better version in a template's style.";

  static override examples = [
    '<%= config.bin %> improve --source deck.pptx --template acme-brand',
    '<%= config.bin %> improve --source deck.pptx --template acme-brand --skill story-arc my-project',
  ];

  static override args = {
    project: Args.string({
      required: false,
      description: 'Project name (lower-case kebab). Defaults to <source-stem>-improved.',
    }),
  };

  static override flags = {
    source: Flags.string({
      description: 'Path to the SOURCE .pptx (the deck to critique and improve).',
      required: true,
    }),
    template: Flags.string({
      description: 'Name of a saved template (~/.deckpilot/templates/) to style the rebuilt deck.',
      required: true,
    }),
    skill: Flags.string({
      description: 'Optional skill (staged AI instructions) to apply, e.g. story-arc.',
      required: false,
    }),
    model: Flags.string({
      description: 'LLM model to use (e.g. claude-sonnet-4.5, gpt-5)',
      required: false,
    }),
    token: Flags.string({
      description: 'GitHub token to pass to the Copilot SDK (overrides env)',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    'critique-passes': Flags.integer({
      description:
        'How many preview passes the model is allowed per slide (0 disables the critique loop). Max 5.',
      required: false,
      min: 0,
      max: 5,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Improve);

    const source = resolve(process.cwd(), flags.source);
    this.requirePptx(source);

    // Fail clearly up front for an empty / unreadable source.
    let slideCount: number;
    try {
      slideCount = await countPptxSlides(source);
    } catch (e) {
      this.fail(`Could not read the source deck: ${(e as Error).message}`);
    }
    if (slideCount === 0) {
      this.fail(`The source deck ${flags.source} has no slides.`);
    }

    // The template is required — verify it exists before starting a session.
    try {
      await loadTemplate(flags.template);
    } catch (e) {
      if (e instanceof TemplateNotFoundError) {
        this.fail(
          `Template "${flags.template}" not found in ~/.deckpilot/templates/.`,
          'List templates with `deckpilot template list`, or create one with `deckpilot template create <name> --from <deck.pptx>`.',
        );
      }
      this.fail(`Could not load template "${flags.template}": ${(e as Error).message}`);
    }

    const cfg = await loadConfig();
    const critiquePasses = flags['critique-passes'] ?? cfg.defaults.critiquePassesPerSlide ?? 3;
    const model = flags.model ?? cfg.defaults.model;
    const projectName = args.project ?? defaultImproveProjectName(source);

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model,
      critiquePassesPerSlide: critiquePasses,
      projectName,
      templateName: flags.template,
      skillName: flags.skill,
      improve: { sourcePath: source },
    });

    try {
      await session.start();
    } catch (e) {
      this.fail(
        `Failed to start Copilot session: ${(e as Error).message}`,
        'Run `deckpilot doctor` to diagnose. Auth issues? `deckpilot auth login`.',
      );
    }

    const inkApp = render(React.createElement(App, { session }));

    // Seed the improve flow only for a fresh project — a resumed one already
    // has a brief/slide code and its source/style are re-applied by start().
    // Fire after mount so the streamed first turn is visible. The source's text
    // rides along as reference context with a generous budget (vision backstops
    // the rest).
    if (session.getBrief() === null && session.getAllSlideCode().size === 0) {
      void session.sendUserMessage(IMPROVE_SEED_PROMPT, [], [source], {
        maxDocChars: IMPROVE_DOC_CHAR_BUDGET,
        maxTotalChars: IMPROVE_DOC_CHAR_BUDGET,
      });
    }

    await inkApp.waitUntilExit();
  }

  private requirePptx(path: string): void {
    if (!existsSync(path)) this.fail(`The source deck does not exist: ${path}`);
    if (extname(path).toLowerCase() !== '.pptx') {
      this.fail(`The source deck must be a .pptx file: ${path}`);
    }
  }
}
