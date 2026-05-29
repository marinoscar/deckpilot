import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import {
  InvalidConfigKeyError,
  canonicalKey,
  loadConfig,
  saveConfig,
  unsetConfigValue,
} from '../../store/config.js';

export default class ConfigUnset extends BaseCommand {
  static override description =
    'Remove one DeckPilot config value. After this, `deckpilot start` falls back to the built-in default for that key.';

  static override examples = [
    '<%= config.bin %> config unset model',
    '<%= config.bin %> config unset critique-passes',
  ];

  static override args = {
    key: Args.string({
      required: true,
      description: 'Config key to unset (canonical or alias).',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigUnset);
    try {
      const cfg = await loadConfig();
      const next = unsetConfigValue(cfg, args.key);
      await saveConfig(next);
      this.log(`unset ${canonicalKey(args.key)}`);
    } catch (e) {
      if (e instanceof InvalidConfigKeyError) this.fail(e.message);
      this.handle(e);
    }
  }
}
