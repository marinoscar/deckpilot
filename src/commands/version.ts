import { BaseCommand } from '../cli/base-command.js';
import { checkForUpdate } from '../util/version-check.js';

export default class Version extends BaseCommand {
  static override description = 'Print the DeckPilot version.';

  static override examples = ['<%= config.bin %> version', '<%= config.bin %> --version'];

  static override aliases = ['ver'];

  async run(): Promise<void> {
    this.log(`DeckPilot ${this.config.version}`);
    this.log(`  bin       ${this.config.bin}`);
    this.log(`  platform  ${this.config.platform} ${this.config.arch}`);
    this.log(`  node      ${process.version}`);
    this.log(`  root      ${this.config.root}`);

    // Best-effort, cached once a day; never blocks the version print on error.
    const update = await checkForUpdate(this.config.version);
    if (update) {
      this.log('');
      this.log(
        `\x1b[33m✨ v${update.latest} is available — re-run the installer to update.\x1b[0m`,
      );
    }
  }
}
