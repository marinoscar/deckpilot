import type { CopilotSession, ModelInfo } from '@github/copilot-sdk';
import type { DeckPilotClient } from '../copilot/client.js';
import { UNKNOWN_MODEL_LABEL } from '../copilot/client.js';
import { buildToolRegistry } from '../copilot/tools.js';
import { M1_SYSTEM_PROMPT } from './system-prompt.js';
import { log } from '../util/logger.js';

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tool: string; status: 'start' | 'done' | 'error'; detail?: string }
  | { kind: 'system'; id: string; text: string };

export type SessionListener = (entries: TranscriptEntry[]) => void;
export type ModelListener = (model: string) => void;

export type ChatSessionOptions = {
  model?: string;
};

export class ChatSession {
  private transcript: TranscriptEntry[] = [];
  private listeners = new Set<SessionListener>();
  private modelListeners = new Set<ModelListener>();
  private session: CopilotSession | null = null;
  private streamingId: string | null = null;
  private nextId = 1;
  /** Model the user requested at startup (via `--model`). `undefined` means "use the Copilot CLI's configured default". */
  private requestedModel: string | undefined;
  /** Model the SDK has actually reported as active. Empty until the first session.model_change event arrives. */
  private activeModel: string | null = null;

  constructor(
    private readonly dp: DeckPilotClient,
    opts: ChatSessionOptions = {},
  ) {
    this.requestedModel = opts.model;
    this.activeModel = opts.model ?? null;
  }

  getModel(): string {
    return this.activeModel ?? UNKNOWN_MODEL_LABEL;
  }

  onModelChange(fn: ModelListener): () => void {
    this.modelListeners.add(fn);
    fn(this.getModel());
    return () => {
      this.modelListeners.delete(fn);
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.dp.listModels();
  }

  async start(): Promise<void> {
    await this.dp.start();
    this.session = await this.dp.createSession({
      systemPrompt: M1_SYSTEM_PROMPT,
      tools: buildToolRegistry(),
      streaming: true,
      model: this.requestedModel,
    });
    this.attachEvents(this.session);
  }

  /**
   * Switch the active model. Uses the SDK's `session.setModel()` which takes
   * effect on the next message AND preserves conversation history — no
   * disconnect/recreate required. The actual model id displayed in the UI
   * updates when the SDK emits `session.model_change`.
   */
  async switchModel(newModel: string): Promise<void> {
    if (!this.session) throw new Error('Session not started');
    const trimmed = newModel.trim();
    if (!trimmed) return;
    if (trimmed === this.activeModel) {
      this.addSystemMessage(`Already using ${trimmed}.`);
      return;
    }
    try {
      await this.session.setModel(trimmed);
      // The model_change event will update this.activeModel and fire
      // modelListeners; we just confirm the request landed.
      this.addSystemMessage(`Requested model → ${trimmed}. Takes effect on the next message.`);
    } catch (e) {
      this.addSystemMessage(`Could not switch to ${trimmed}: ${(e as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    try {
      await this.session?.disconnect();
    } catch (e) {
      log.warn('session.disconnect failed:', (e as Error).message);
    }
    await this.dp.stop();
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener([...this.transcript]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  addSystemMessage(text: string): void {
    this.push({ kind: 'system', id: this.id(), text });
  }

  async sendUserMessage(text: string): Promise<void> {
    if (!this.session) throw new Error('Session not started');
    this.push({ kind: 'user', id: this.id(), text });
    await this.session.send({ prompt: text });
  }

  async cancel(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.abort();
    } catch (e) {
      log.warn('session.abort failed:', (e as Error).message);
    }
  }

  clear(): void {
    this.transcript = [];
    this.streamingId = null;
    this.emit();
  }

  private attachEvents(session: CopilotSession): void {
    session.on('user.message', () => {});
    session.on('assistant.message_delta', (event) => {
      const delta: string = (event.data as { deltaContent?: string }).deltaContent ?? '';
      this.appendAssistantDelta(delta);
    });
    session.on('assistant.message', (event) => {
      const content: string = (event.data as { content?: string }).content ?? '';
      this.finalizeAssistant(content);
    });
    session.on('tool.execution_start', (event) => {
      const data = event.data as { toolName?: string };
      this.push({
        kind: 'tool',
        id: this.id(),
        tool: data.toolName ?? 'unknown',
        status: 'start',
      });
    });
    session.on('tool.execution_complete', (event) => {
      const data = event.data as { toolName?: string; resultType?: string };
      this.push({
        kind: 'tool',
        id: this.id(),
        tool: data.toolName ?? 'unknown',
        status: data.resultType === 'failure' ? 'error' : 'done',
      });
    });
    session.on('session.idle', () => {
      this.streamingId = null;
      this.emit();
    });
    session.on('session.model_change', (event) => {
      const data = event.data as { newModel?: string; previousModel?: string; cause?: string };
      if (!data.newModel) return;
      this.activeModel = data.newModel;
      if (data.cause === 'rate_limit_auto_switch' && data.previousModel) {
        this.addSystemMessage(
          `Copilot auto-switched model from ${data.previousModel} → ${data.newModel} (rate limit).`,
        );
      }
      for (const fn of this.modelListeners) fn(data.newModel);
    });
  }

  private appendAssistantDelta(delta: string): void {
    if (!delta) return;
    if (this.streamingId == null) {
      const id = this.id();
      this.streamingId = id;
      this.transcript.push({ kind: 'assistant', id, text: delta, streaming: true });
    } else {
      const last = this.transcript[this.transcript.length - 1];
      if (last && last.kind === 'assistant' && last.id === this.streamingId) {
        last.text += delta;
      }
    }
    this.emit();
  }

  private finalizeAssistant(content: string): void {
    if (this.streamingId != null) {
      const last = this.transcript[this.transcript.length - 1];
      if (last && last.kind === 'assistant' && last.id === this.streamingId) {
        if (content && content.length > last.text.length) last.text = content;
        last.streaming = false;
      }
    } else if (content) {
      this.push({ kind: 'assistant', id: this.id(), text: content, streaming: false });
    }
    this.streamingId = null;
    this.emit();
  }

  private push(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.emit();
  }

  private emit(): void {
    const snapshot = [...this.transcript];
    for (const l of this.listeners) l(snapshot);
  }

  private id(): string {
    return `e${this.nextId++}`;
  }
}
