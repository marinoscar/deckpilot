import { Args } from '@oclif/core';
import { BaseCommand } from '../cli/base-command.js';
import { describeTokenSource, resolveGitHubToken } from '../copilot/auth.js';
import { createClient } from '../copilot/client.js';

type SubCmd = 'login' | 'logout' | 'status';

export default class Auth extends BaseCommand {
  static override description =
    'Manage GitHub Copilot authentication. Delegates to the underlying Copilot CLI for the device-flow login.';

  static override examples = [
    '<%= config.bin %> auth status',
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth logout',
  ];

  static override args = {
    sub: Args.string({
      name: 'sub',
      required: true,
      options: ['login', 'logout', 'status'],
      description: 'Auth subcommand',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Auth);
    const sub = args.sub as SubCmd;
    switch (sub) {
      case 'status':
        return this.status();
      case 'login':
        return this.login();
      case 'logout':
        return this.logout();
    }
  }

  private async status(): Promise<void> {
    const tok = resolveGitHubToken();
    this.log(`Token source: ${describeTokenSource(tok.source)}`);
    try {
      const dp = createClient();
      await dp.start();
      this.log('Copilot SDK started OK.');
      await dp.stop();
    } catch (e) {
      this.log(`Copilot SDK failed to start: ${(e as Error).message}`);
      this.log('Run `deckpilot auth login` to authenticate.');
    }
  }

  private async login(): Promise<void> {
    this.log(
      'DeckPilot uses the GitHub Copilot CLI for authentication.\n' +
        'Run the following in a separate terminal to start the device-flow login:\n\n' +
        '    npx -p @github/copilot copilot auth login\n\n' +
        'After completing the browser flow, run `deckpilot auth status` to confirm.',
    );
  }

  private async logout(): Promise<void> {
    this.log('Run `npx -p @github/copilot copilot auth logout` to clear the Copilot CLI keychain.');
  }
}
