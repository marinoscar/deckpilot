import { Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { BaseCommand } from '../cli/base-command.js';
import { isCopilotOnboarded } from '../store/config.js';
import { RootApp } from '../ui/RootApp.js';

export default class Menu extends BaseCommand {
  static override description =
    'Open the DeckPilot main menu (also runs when you invoke `deckpilot` with no arguments).';

  static override examples = ['<%= config.bin %>', '<%= config.bin %> menu'];

  static override flags = {
    token: Flags.string({
      description: 'GitHub token forwarded to chat sessions started from the menu.',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    model: Flags.string({ description: 'Default LLM model for chat sessions.', required: false }),
    'critique-passes': Flags.integer({
      description: 'Per-slide critique budget (0 disables, max 5).',
      required: false,
      default: 3,
      min: 0,
      max: 5,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Menu);
    // First run (or Copilot never verified) → gate on the readiness screen so
    // the user confirms Copilot is signed in and ready before their first deck.
    const onboarded = await isCopilotOnboarded();
    const app = render(
      React.createElement(RootApp, {
        token: flags.token,
        model: flags.model,
        critiquePassesPerSlide: flags['critique-passes'],
        requireCopilotCheck: !onboarded,
      }),
    );
    await app.waitUntilExit();
  }
}
