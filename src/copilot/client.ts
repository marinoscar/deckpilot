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

export type ResumeSessionOptions = {
  sessionId: string;
  /** Optional fresh tool list. The SDK rebinds tools on resume. */
  tools?: Tool[];
};

export class SessionResumeFailedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly cause: Error,
  ) {
    super(`Could not resume Copilot session "${sessionId}": ${cause.message}`);
    this.name = 'SessionResumeFailedError';
  }
}

export type DeckPilotClient = {
  client: CopilotClient;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createSession: (opts: CreateSessionOptions) => Promise<CopilotSession>;
  resumeSession: (opts: ResumeSessionOptions) => Promise<CopilotSession>;
  listModels: () => Promise<ModelInfo[]>;
};

export const UNKNOWN_MODEL_LABEL = '(copilot default)';

/**
 * Env for the spawned Copilot runtime, with Node's experimental-feature warnings
 * silenced. The bundled CLI uses `node:sqlite`, which makes Node print a noisy
 * `ExperimentalWarning: SQLite is an experimental feature …` on every run — it's
 * not actionable for our users. We add `--disable-warning=ExperimentalWarning`
 * (Node ≥ 22) rather than `NODE_NO_WARNINGS`, so genuine deprecation warnings
 * still surface. The SDK *replaces* `process.env` with whatever we pass (it does
 * `options.env ?? process.env`), so we spread it rather than set in isolation.
 */
function runtimeEnvWithoutExperimentalWarnings(): Record<string, string | undefined> {
  const flag = '--disable-warning=ExperimentalWarning';
  const existing = process.env.NODE_OPTIONS?.trim();
  const nodeOptions = !existing ? flag : existing.includes(flag) ? existing : `${existing} ${flag}`;
  return { ...process.env, NODE_OPTIONS: nodeOptions };
}

export function createClient(opts: CreateClientOptions = {}): DeckPilotClient {
  const { token } = resolveGitHubToken(opts.gitHubToken);
  const client = new CopilotClient({
    gitHubToken: token,
    baseDirectory: opts.baseDirectory,
    env: runtimeEnvWithoutExperimentalWarnings(),
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
    async resumeSession(o) {
      try {
        const session = await client.resumeSession(o.sessionId, {
          tools: o.tools,
          onPermissionRequest: approveAll,
        });
        return session;
      } catch (e) {
        throw new SessionResumeFailedError(o.sessionId, e as Error);
      }
    },
    async listModels() {
      return client.listModels();
    },
  };
}
