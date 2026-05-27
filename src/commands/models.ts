import { BaseCommand } from '../cli/base-command.js';
import { createClient, DEFAULT_MODEL } from '../copilot/client.js';

export default class Models extends BaseCommand {
  static override description =
    'List LLM models available to DeckPilot via the Copilot SDK. The default model is marked with *.';

  static override examples = ['<%= config.bin %> models'];

  async run(): Promise<void> {
    const dp = createClient();
    try {
      await dp.start();
    } catch (e) {
      this.fail(
        `Could not start the Copilot SDK: ${(e as Error).message}`,
        'Run `deckpilot doctor` and `deckpilot auth login`.',
      );
    }
    try {
      const models = await dp.listModels();
      if (models.length === 0) {
        this.log('No models returned by Copilot SDK.');
        return;
      }
      const idW = Math.max(...models.map((m) => m.id.length));
      for (const m of models) {
        const marker = m.id === DEFAULT_MODEL ? '*' : ' ';
        const reasoning = m.supportedReasoningEfforts?.length
          ? ` (reasoning: ${m.supportedReasoningEfforts.join(', ')})`
          : '';
        this.log(`${marker} ${m.id.padEnd(idW)}  ${m.name}${reasoning}`);
      }
    } catch (e) {
      this.fail(`listModels failed: ${(e as Error).message}`);
    } finally {
      await dp.stop();
    }
  }
}
