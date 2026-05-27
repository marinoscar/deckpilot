import { BaseCommand } from '../cli/base-command.js';

export default class Version extends BaseCommand {
  static override description = 'Print the DeckPilot version.';

  static override examples = [
    '<%= config.bin %> version',
    '<%= config.bin %> --version',
  ];

  static override aliases = ['ver'];

  async run(): Promise<void> {
    this.log(`DeckPilot ${this.config.version}`);
    this.log(`  bin       ${this.config.bin}`);
    this.log(`  platform  ${this.config.platform} ${this.config.arch}`);
    this.log(`  node      ${process.version}`);
    this.log(`  root      ${this.config.root}`);
  }
}
