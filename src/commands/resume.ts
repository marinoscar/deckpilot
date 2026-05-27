import { existsSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { ChatSession } from '../chat/session.js';
import { BaseCommand } from '../cli/base-command.js';
import { createClient } from '../copilot/client.js';
import { projectExists } from '../store/projects.js';
import { App } from '../ui/App.js';

export default class Resume extends BaseCommand {
  static override description =
    'Resume a previously-saved DeckPilot project. Equivalent to `deckpilot chat <name>` for an existing project.';

  static override examples = ['<%= config.bin %> resume my-pitch'];

  static override args = {
    project: Args.string({ required: true, description: 'Project name to resume.' }),
  };

  static override flags = {
    model: Flags.string({
      description: 'Override the LLM model for this session.',
      required: false,
    }),
    token: Flags.string({
      description: 'GitHub token (overrides env)',
      required: false,
      env: 'COPILOT_GITHUB_TOKEN',
    }),
    template: Flags.string({
      description:
        'Override the saved template — either a named template or a path to a .pptx for one-shot inheritance.',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Resume);
    if (!(await projectExists(args.project))) {
      this.fail(
        `No project named "${args.project}" under ~/.deckpilot/projects/.`,
        "Try `deckpilot project list` to see what's saved, or `deckpilot chat <name>` to start a new one.",
      );
    }

    let templateName: string | undefined;
    let templatePath: string | undefined;
    if (flags.template) {
      if (/^[a-z0-9-]+$/.test(flags.template) && !existsSync(flags.template)) {
        templateName = flags.template;
      } else {
        templatePath = flags.template;
      }
    }

    const dp = createClient({ gitHubToken: flags.token });
    const session = new ChatSession(dp, {
      projectName: args.project,
      model: flags.model,
      templateName,
      templatePath,
    });

    try {
      await session.start();
    } catch (e) {
      this.fail(`Could not resume "${args.project}": ${(e as Error).message}`);
    }

    const inkApp = render(React.createElement(App, { session }));
    await inkApp.waitUntilExit();
  }
}
