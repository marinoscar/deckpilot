import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import {
  InvalidConfigKeyError,
  InvalidConfigValueError,
  canonicalKey,
  loadConfig,
  saveConfig,
  setConfigValue,
} from '../../store/config.js';

export default class ConfigSet extends BaseCommand {
  static override description =
    'Set one DeckPilot config value, persisted at ~/.deckpilot/config.json (Windows: %USERPROFILE%\\.deckpilot\\config.json). These defaults are used by `start`, `chat`, and `resume` when no CLI flag is passed.';

  static override examples = [
    '<%= config.bin %> config set critique-passes 3',
    '<%= config.bin %> config set model gpt-5',
    '<%= config.bin %> config set defaults.template acme-corp',
  ];

  static override args = {
    key: Args.string({
      required: true,
      description: 'Config key (canonical or alias).',
    }),
    value: Args.string({
      required: true,
      description: 'New value (coerced as needed for numeric keys).',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSet);
    try {
      const cfg = await loadConfig();
      const next = setConfigValue(cfg, args.key, args.value);
      await saveConfig(next);
      this.log(`set ${canonicalKey(args.key)} = ${args.value}`);
    } catch (e) {
      if (e instanceof InvalidConfigKeyError || e instanceof InvalidConfigValueError) {
        this.fail(e.message);
      }
      this.handle(e);
    }
  }
}
