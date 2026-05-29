import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import {
  InvalidConfigKeyError,
  canonicalKey,
  getConfigValue,
  loadConfig,
} from '../../store/config.js';

export default class ConfigGet extends BaseCommand {
  static override description =
    'Print one DeckPilot config value (or nothing, with exit code 1, if the key is unset). Accepts canonical paths like `defaults.model` or friendly aliases like `model` and `critique-passes`.';

  static override examples = [
    '<%= config.bin %> config get model',
    '<%= config.bin %> config get critique-passes',
    '<%= config.bin %> config get defaults.template',
  ];

  static override args = {
    key: Args.string({
      required: true,
      description: 'Config key (canonical or alias).',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGet);
    try {
      const cfg = await loadConfig();
      const v = getConfigValue(cfg, args.key);
      if (v === undefined) {
        this.error(`${canonicalKey(args.key)} is unset.`, { exit: 1 });
      }
      this.log(typeof v === 'string' ? v : JSON.stringify(v));
    } catch (e) {
      if (e instanceof InvalidConfigKeyError) this.fail(e.message);
      this.handle(e);
    }
  }
}
