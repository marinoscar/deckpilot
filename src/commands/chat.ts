import React from 'react';
import { render } from 'ink';
import { Flags } from '@oclif/core';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { ChatSession } from '../chat/session.js';
import { App } from '../ui/App.js';

export default class Chat extends BaseCommand {
  static override description =
    'Enter the interactive DeckPilot chat. Have a conversation with GitHub Copilot to plan and produce a PowerPoint deck.';

  static override examples = [
    '<%= config.bin %> chat',
    '<%= config.bin %> chat --model gpt-5',
  ];

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
      description: 'Path to a .pptx to inherit theme + fonts from (renders will use its style).',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Chat);
    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      model: flags.model,
      templatePath: flags.template,
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
