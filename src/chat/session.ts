import type { CopilotSession } from '@github/copilot-sdk';
import type { DeckPilotClient } from '../copilot/client.js';
import { buildToolRegistry } from '../copilot/tools.js';
import { M1_SYSTEM_PROMPT } from './system-prompt.js';
import { log } from '../util/logger.js';

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tool: string; status: 'start' | 'done' | 'error'; detail?: string }
  | { kind: 'system'; id: string; text: string };

export type SessionListener = (entries: TranscriptEntry[]) => void;

export class ChatSession {
  private transcript: TranscriptEntry[] = [];
  private listeners = new Set<SessionListener>();
  private session: CopilotSession | null = null;
  private streamingId: string | null = null;
  private nextId = 1;

  constructor(private readonly dp: DeckPilotClient) {}

  async start(): Promise<void> {
    await this.dp.start();
    this.session = await this.dp.createSession({
      systemPrompt: M1_SYSTEM_PROMPT,
      tools: buildToolRegistry(),
      streaming: true,
    });
    this.attachEvents(this.session);
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
