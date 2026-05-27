import { existsSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { ChatSession } from '../chat/session.js';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { listTemplates } from '../store/templates.js';
import { App } from '../ui/App.js';
import { TemplatePicker } from '../ui/TemplatePicker.js';

export default class Chat extends BaseCommand {
  static override description =
    'Enter the interactive DeckPilot chat. Have a conversation with GitHub Copilot to plan and produce a PowerPoint deck.';

  static override examples = [
    '<%= config.bin %> chat',
    '<%= config.bin %> chat my-pitch',
    '<%= config.bin %> chat my-pitch --template acme-corp',
    '<%= config.bin %> chat --model gpt-5',
  ];

  static override args = {
    project: Args.string({
      required: false,
      description:
        "Project name (lower-case kebab). Resumes if it exists, creates if it doesn't. Omit to auto-name project-N.",
    }),
  };

  static override flags = {
    model: Flags.string({
      description: 'LLM model to use (e.g. claude-sonnet-4.5, gpt-5)',
      required: false,
    }),
    token: Flags.string({
      description: 'GitHub token to pass to the Copilot SDK (overrides env)',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    template: Flags.string({
      description:
        'Named template (from ~/.deckpilot/templates/) OR path to a .pptx to inherit theme/fonts from one-shot.',
      required: false,
    }),
    'no-picker': Flags.boolean({
      description:
        'Skip the startup template picker even when templates are saved and no --template flag is set.',
      default: false,
    }),
    'critique-passes': Flags.integer({
      description:
        'How many render_slide_preview passes the model is allowed per slide (0 disables the visual critique loop). Default 3, max 5.',
      required: false,
      default: 3,
      min: 0,
      max: 5,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Chat);

    // Disambiguate --template: is it a saved name, or a path to a .pptx?
    let templateName: string | undefined;
    let templatePath: string | undefined;
    if (flags.template) {
      if (/^[a-z0-9-]+$/.test(flags.template) && !existsSync(flags.template)) {
        templateName = flags.template;
      } else {
        templatePath = flags.template;
      }
    }

    // Startup TUI picker — only when no template was named AND saved
    // templates exist AND the user didn't opt out.
    if (!templateName && !templatePath && !flags['no-picker']) {
      const saved = await listTemplates();
      if (saved.length > 0) {
        templateName = await TemplatePicker.pickInteractive(saved);
      }
    }

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model: flags.model,
      templatePath,
      templateName,
      projectName: args.project,
      critiquePassesPerSlide: flags['critique-passes'],
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
    await inkApp.waitUntilExit();
  }
}
