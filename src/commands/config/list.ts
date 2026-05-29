import { BaseCommand } from '../../cli/base-command.js';
import {
  type Config,
  SETTABLE_KEYS,
  configPath,
  getConfigValue,
  loadConfig,
} from '../../store/config.js';

export default class ConfigList extends BaseCommand {
  static override description =
    'Show every settable DeckPilot config key, the value if set, and where the file lives. Use this to inspect what `deckpilot start` will use as defaults.';

  static override examples = ['<%= config.bin %> config list'];

  async run(): Promise<void> {
    let cfg: Config;
    try {
      cfg = await loadConfig();
    } catch (e) {
      this.fail((e as Error).message);
    }
    this.log(`config file: ${configPath()}`);
    this.log('');
    let any = false;
    for (const key of SETTABLE_KEYS) {
      const v = getConfigValue(cfg, key);
      if (v !== undefined) any = true;
      const display = v === undefined ? '(unset)' : JSON.stringify(v);
      this.log(`  ${key.padEnd(36)}  ${display}`);
    }
    if (!any) {
      this.log('');
      this.log('No defaults set yet. Set one with:');
      this.log('  deckpilot config set critique-passes 3');
    }
  }
}
