import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { CopilotSession, Tool } from '@github/copilot-sdk';
import { resolveGitHubToken } from './auth.js';
import { log } from '../util/logger.js';

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
};

export const DEFAULT_MODEL = 'claude-sonnet-4.5';

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
      const session = await client.createSession({
        model: o.model ?? DEFAULT_MODEL,
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
  };
}
