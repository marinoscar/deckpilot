import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { ChatSession } from '../chat/session.js';
import {
  MAX_TRANSFORM_SLIDES,
  TRANSFORM_DOC_CHAR_BUDGET,
  TRANSFORM_SEED_PROMPT,
  countPptxSlides,
  defaultTransformProjectName,
} from '../chat/transform.js';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { loadConfig } from '../store/config.js';
import { listTemplates, templateExists } from '../store/templates.js';
import { App } from '../ui/App.js';
import { TemplatePicker } from '../ui/TemplatePicker.js';

/**
 * `deckpilot transform` — restyle a deck: reproduce a deck's content 1:1 while
 * adopting a template's visual style, then drop into chat for adjustments.
 *
 * Two inputs: the DECK to restyle (content) and the TEMPLATE that supplies the
 * style. The deck is seeded as content (text + a study_original_slides vision
 * tool); the template flows through the normal named/one-shot template path.
 * The agent proposes the 1:1 brief and then — uniquely for transform mode —
 * builds and saves automatically (no "build" approval gate) before leaving the
 * chat open.
 */
export default class Transform extends BaseCommand {
  static override description =
    "Restyle a deck: reproduce a deck's content 1:1 in a template's visual style, then chat for tweaks.";

  static override examples = [
    '<%= config.bin %> transform --deck client-a.pptx --template acme-brand',
    '<%= config.bin %> transform --deck deck.pptx --template brand.pptx my-rebrand',
  ];

  static override args = {
    project: Args.string({
      required: false,
      description: 'Project name (lower-case kebab). Defaults to <deck-stem>-transformed.',
    }),
  };

  static override flags = {
    deck: Flags.string({
      description: 'Path to the .pptx to restyle (the content to reproduce).',
      required: true,
    }),
    template: Flags.string({
      description:
        'Named template (from ~/.deckpilot/templates/) OR path to a .pptx to adopt the style of. Omit to pick one interactively.',
      required: false,
    }),
    'no-picker': Flags.boolean({
      description:
        'Skip the interactive template picker even when templates are saved and no --template is set.',
      default: false,
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
    const { args, flags } = await this.parse(Transform);

    const deck = resolve(process.cwd(), flags.deck);
    this.requirePptx(deck);

    // Strict 1:1 can't exceed the brief's slide cap — fail clearly up front.
    let slideCount: number;
    try {
      slideCount = await countPptxSlides(deck);
    } catch (e) {
      this.fail(`Could not read the deck: ${(e as Error).message}`);
    }
    if (slideCount === 0) {
      this.fail(`The deck ${flags.deck} has no slides.`);
    }
    if (slideCount > MAX_TRANSFORM_SLIDES) {
      this.fail(
        `The deck has ${slideCount} slides; transform supports up to ${MAX_TRANSFORM_SLIDES} (the deck brief is capped at ${MAX_TRANSFORM_SLIDES}).`,
        'Split the deck or trim it to ≤40 slides, then re-run.',
      );
    }

    const cfg = await loadConfig();

    // Resolve the style template, mirroring `deckpilot start`: a kebab name that
    // isn't a path on disk is a saved template; anything else is a one-shot
    // .pptx. Falls back to config default, then the interactive picker.
    let templateName: string | undefined;
    let templatePath: string | undefined;
    if (flags.template) {
      if (/^[a-z0-9-]+$/.test(flags.template) && !existsSync(flags.template)) {
        templateName = flags.template;
      } else {
        templatePath = flags.template;
      }
    } else if (cfg.defaults.template && (await templateExists(cfg.defaults.template))) {
      templateName = cfg.defaults.template;
    }

    if (!templateName && !templatePath && !flags['no-picker']) {
      const saved = await listTemplates();
      if (saved.length > 0) {
        templateName = await TemplatePicker.pickInteractive(saved);
      }
    }

    if (!templateName && !templatePath) {
      this.fail(
        'Transform needs a template for the deck’s new style, but none was given or picked.',
        'Pass --template <name|deck.pptx>, or create one first: `deckpilot template create <name> --from <deck.pptx>`.',
      );
    }

    const critiquePasses = flags['critique-passes'] ?? cfg.defaults.critiquePassesPerSlide ?? 3;
    const model = flags.model ?? cfg.defaults.model;
    const projectName = args.project ?? defaultTransformProjectName(deck);

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model,
      templateName,
      templatePath,
      critiquePassesPerSlide: critiquePasses,
      projectName,
      transform: { originalPath: deck },
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

    // Seed the transform only for a fresh project — a resumed one already has a
    // brief/slide code and its style is re-applied by start(). Fire after mount
    // so the streamed first turn is visible. The deck's text rides along as
    // reference context with a generous budget (vision backstops the rest).
    if (session.getBrief() === null && session.getAllSlideCode().size === 0) {
      void session.sendUserMessage(TRANSFORM_SEED_PROMPT, [], [deck], {
        maxDocChars: TRANSFORM_DOC_CHAR_BUDGET,
        maxTotalChars: TRANSFORM_DOC_CHAR_BUDGET,
      });
    }

    await inkApp.waitUntilExit();
  }

  private requirePptx(path: string): void {
    if (!existsSync(path)) this.fail(`The deck does not exist: ${path}`);
    if (extname(path).toLowerCase() !== '.pptx') {
      this.fail(`The deck must be a .pptx file: ${path}`);
    }
  }
}
