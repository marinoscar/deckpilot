import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { CopilotSession, ModelInfo, Tool } from '@github/copilot-sdk';
import { log } from '../util/logger.js';
import { resolveGitHubToken } from './auth.js';

export type CreateClientOptions = {
  gitHubToken?: string;
  baseDirectory?: string;
};

export type CreateSessionOptions = {
  model?: string;
  systemPrompt?: string;
  tools?: Tool[];
  streaming?: boolean;
};

export type DeckPilotClient = {
  client: CopilotClient;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createSession: (opts: CreateSessionOptions) => Promise<CopilotSession>;
  listModels: () => Promise<ModelInfo[]>;
};

/**
 * Display label used when the SDK has not yet reported an active model. Once
 * the session emits its first `session.model_change` event (or the first
 * assistant message arrives), the real model id replaces this label.
 */
export const UNKNOWN_MODEL_LABEL = '(copilot default)';

export function createClient(opts: CreateClientOptions = {}): DeckPilotClient {
  const { token } = resolveGitHubToken(opts.gitHubToken);
  const client = new CopilotClient({
    gitHubToken: token,
    baseDirectory: opts.baseDirectory,
  });

  return {
    client,
    async start() {
      log.debug('Starting Copilot SDK client');
      await client.start();
    },
    async stop() {
      log.debug('Stopping Copilot SDK client');
      const errs = await client.stop();
      for (const e of errs) log.warn('SDK stop error:', e?.message ?? e);
    },
    async createSession(o) {
      // Important: pass `model` through only when the caller explicitly set
      // one. Omitting it lets the SDK use whatever the user has configured in
      // their Copilot CLI (`~/.copilot/config.json` / interactive `/model`
      // selection). Forcing a default here would shadow that choice.
      const session = await client.createSession({
        ...(o.model ? { model: o.model } : {}),
        tools: o.tools,
        onPermissionRequest: approveAll,
        streaming: true,
        systemMessage: o.systemPrompt
          ? {
              mode: 'append',
              content: o.systemPrompt,
            }
          : undefined,
      });
      return session;
    },
    async listModels() {
      return client.listModels();
    },
  };
}
