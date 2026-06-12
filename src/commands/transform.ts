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
import { App } from '../ui/App.js';

/**
 * `deckpilot transform` — reproduce an ORIGINAL deck's content in a TARGET
 * deck's visual style, then drop into chat for adjustments. Composes the
 * existing pipeline: the target is applied as a one-shot style template, the
 * original is seeded as content (text + a study_original_slides vision tool),
 * and the normal propose → approve → build → critique loop runs from there.
 */
export default class Transform extends BaseCommand {
  static override description =
    "Restyle a deck: reproduce an original deck's content in a target deck's visual style.";

  static override examples = [
    '<%= config.bin %> transform --original client-a.pptx --target client-b.pptx',
    '<%= config.bin %> transform --original deck.pptx --target brand.pptx my-project',
  ];

  static override args = {
    project: Args.string({
      required: false,
      description: 'Project name (lower-case kebab). Defaults to <original-stem>-transformed.',
    }),
  };

  static override flags = {
    original: Flags.string({
      description: 'Path to the ORIGINAL .pptx (the content to reproduce).',
      required: true,
    }),
    target: Flags.string({
      description: 'Path to the TARGET .pptx (the style/brand/colours to adopt).',
      required: true,
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

    const original = resolve(process.cwd(), flags.original);
    const target = resolve(process.cwd(), flags.target);
    this.requirePptx(original, 'original');
    this.requirePptx(target, 'target');

    // Strict 1:1 can't exceed the brief's slide cap — fail clearly up front.
    let slideCount: number;
    try {
      slideCount = await countPptxSlides(original);
    } catch (e) {
      this.fail(`Could not read the original deck: ${(e as Error).message}`);
    }
    if (slideCount === 0) {
      this.fail(`The original deck ${flags.original} has no slides.`);
    }
    if (slideCount > MAX_TRANSFORM_SLIDES) {
      this.fail(
        `The original deck has ${slideCount} slides; transform supports up to ${MAX_TRANSFORM_SLIDES} (the deck brief is capped at ${MAX_TRANSFORM_SLIDES}).`,
        'Split the deck or trim it to ≤40 slides, then re-run.',
      );
    }

    const cfg = await loadConfig();
    const critiquePasses = flags['critique-passes'] ?? cfg.defaults.critiquePassesPerSlide ?? 3;
    const model = flags.model ?? cfg.defaults.model;
    const projectName = args.project ?? defaultTransformProjectName(original);

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model,
      critiquePassesPerSlide: critiquePasses,
      projectName,
      transform: { originalPath: original, targetPath: target },
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
    // so the streamed first turn is visible. The original's text rides along as
    // reference context with a generous budget (vision backstops the rest).
    if (session.getBrief() === null && session.getAllSlideCode().size === 0) {
      void session.sendUserMessage(TRANSFORM_SEED_PROMPT, [], [original], {
        maxDocChars: TRANSFORM_DOC_CHAR_BUDGET,
        maxTotalChars: TRANSFORM_DOC_CHAR_BUDGET,
      });
    }

    await inkApp.waitUntilExit();
  }

  private requirePptx(path: string, label: 'original' | 'target'): void {
    if (!existsSync(path)) this.fail(`The ${label} deck does not exist: ${path}`);
    if (extname(path).toLowerCase() !== '.pptx') {
      this.fail(`The ${label} deck must be a .pptx file: ${path}`);
    }
  }
}
