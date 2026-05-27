import type { CopilotSession, ModelInfo } from '@github/copilot-sdk';
import type { DeckPilotClient } from '../copilot/client.js';
import { UNKNOWN_MODEL_LABEL } from '../copilot/client.js';
import { buildDeckTools, type DeckToolContext } from '../tools/index.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { applySlidePatch } from '../deck/revise.js';
import type { Slide, SlidePatch, SlidePlan } from '../deck/schema.js';
import { SlidePlanSchema } from '../deck/schema.js';
import type { TemplateProfile } from '../template/profile.js';
import { summarizeTemplate } from '../template/profile.js';
import { inspectTemplate } from '../template/inspect.js';
import { log } from '../util/logger.js';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tool: string; status: 'start' | 'done' | 'error'; detail?: string }
  | { kind: 'system'; id: string; text: string };

export type SessionListener = (entries: TranscriptEntry[]) => void;
export type ModelListener = (model: string) => void;
export type BusyListener = (busy: boolean) => void;
export type PlanListener = (plan: SlidePlan | null) => void;
export type TemplateListener = (template: TemplateProfile | null) => void;

export type ChatSessionOptions = {
  model?: string;
  /** Path to a `.pptx` whose theme/fonts should be inherited at startup. */
  templatePath?: string;
};

/** Maximum SlidePlan revisions we keep around for `/undo`. */
const UNDO_DEPTH = 20;

export class ChatSession {
  private transcript: TranscriptEntry[] = [];
  private listeners = new Set<SessionListener>();
  private modelListeners = new Set<ModelListener>();
  private busyListeners = new Set<BusyListener>();
  private busy = false;
  private session: CopilotSession | null = null;
  private streamingId: string | null = null;
  private nextId = 1;
  /** Model the user requested at startup (via `--model`). `undefined` means "use the Copilot CLI's configured default". */
  private requestedModel: string | undefined;
  /** Model the SDK has actually reported as active. Empty until the first session.model_change event arrives. */
  private activeModel: string | null = null;

  /** Working SlidePlan. Mutated by tools and slash commands. */
  private plan: SlidePlan | null = null;
  /** Stack of prior plan snapshots for `/undo`. Each propose_outline / revise_slide pushes the previous plan. */
  private planHistory: (SlidePlan | null)[] = [];
  private planListeners = new Set<PlanListener>();

  /** Active template, inherited theme + fonts during rendering. */
  private template: TemplateProfile | null = null;
  private templateListeners = new Set<TemplateListener>();
  /** Where to load a template from on first start, if the user passed one. */
  private requestedTemplatePath: string | undefined;

  constructor(
    private readonly dp: DeckPilotClient,
    opts: ChatSessionOptions = {},
  ) {
    this.requestedModel = opts.model;
    this.activeModel = opts.model ?? null;
    this.requestedTemplatePath = opts.templatePath;
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

  isBusy(): boolean {
    return this.busy;
  }

  onBusyChange(fn: BusyListener): () => void {
    this.busyListeners.add(fn);
    fn(this.busy);
    return () => {
      this.busyListeners.delete(fn);
    };
  }

  private setBusy(next: boolean): void {
    if (this.busy === next) return;
    this.busy = next;
    for (const fn of this.busyListeners) fn(next);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.dp.listModels();
  }

  // ---- deck state ----

  getPlan(): SlidePlan | null {
    return this.plan;
  }

  onPlanChange(fn: PlanListener): () => void {
    this.planListeners.add(fn);
    fn(this.plan);
    return () => {
      this.planListeners.delete(fn);
    };
  }

  setPlan(plan: SlidePlan): void {
    this.planHistory.push(this.plan);
    if (this.planHistory.length > UNDO_DEPTH) this.planHistory.shift();
    this.plan = plan;
    for (const fn of this.planListeners) fn(plan);
  }

  patchSlide(slideId: string, patch: SlidePatch): Slide {
    if (!this.plan) throw new Error('No working plan to patch.');
    const { plan, slide } = applySlidePatch(this.plan, slideId, patch);
    this.planHistory.push(this.plan);
    if (this.planHistory.length > UNDO_DEPTH) this.planHistory.shift();
    this.plan = plan;
    for (const fn of this.planListeners) fn(plan);
    return slide;
  }

  /** Roll back one revision. Returns true if anything was undone. */
  undo(): boolean {
    if (this.planHistory.length === 0) return false;
    const prev = this.planHistory.pop()!;
    this.plan = prev;
    for (const fn of this.planListeners) fn(prev);
    return true;
  }

  // ---- template state ----

  getTemplate(): TemplateProfile | null {
    return this.template;
  }

  onTemplateChange(fn: TemplateListener): () => void {
    this.templateListeners.add(fn);
    fn(this.template);
    return () => {
      this.templateListeners.delete(fn);
    };
  }

  async loadTemplate(path: string): Promise<TemplateProfile> {
    const profile = await inspectTemplate(path);
    this.template = profile;
    for (const fn of this.templateListeners) fn(profile);
    return profile;
  }

  clearTemplate(): void {
    if (!this.template) return;
    this.template = null;
    for (const fn of this.templateListeners) fn(null);
  }

  /**
   * Load a previously-saved DeckPilot `.plan.json` as the working plan. The
   * file MUST be a SlidePlan that validates against the current schema.
   */
  async loadPlanFromFile(path: string): Promise<SlidePlan> {
    const raw = await readFile(resolve(process.cwd(), path), 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
    }
    const parsed = SlidePlanSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `SlidePlan in ${path} failed validation:\n${parsed.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      );
    }
    this.setPlan(parsed.data);
    return parsed.data;
  }

  defaultOutputPath(): string {
    const title = this.plan?.meta.title ?? 'deckpilot-output';
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'deckpilot-output';
    return resolve(process.cwd(), `${slug}.pptx`);
  }

  private toolContext(): DeckToolContext {
    return {
      getPlan: () => this.plan,
      setPlan: (p) => this.setPlan(p),
      patchSlide: (id, patch) => this.patchSlide(id, patch),
      defaultOutputPath: () => this.defaultOutputPath(),
      getTemplate: () => this.template,
      loadTemplate: (p) => this.loadTemplate(p),
    };
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    await this.dp.start();
    this.session = await this.dp.createSession({
      systemPrompt: SYSTEM_PROMPT,
      tools: buildDeckTools(this.toolContext()),
      streaming: true,
      model: this.requestedModel,
    });
    this.attachEvents(this.session);
    if (this.requestedTemplatePath) {
      try {
        const profile = await this.loadTemplate(this.requestedTemplatePath);
        this.addSystemMessage(`Template loaded: ${summarizeTemplate(profile)}`);
      } catch (e) {
        this.addSystemMessage(
          `Could not load template from ${this.requestedTemplatePath}: ${(e as Error).message}`,
        );
      }
    }
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
    this.setBusy(true);
    try {
      await this.session.send({ prompt: text });
    } catch (e) {
      // `send()` returns as soon as the message is queued, but if even that
      // queueing fails we have to clear `busy` ourselves — no `session.idle`
      // event will fire to do it for us.
      this.setBusy(false);
      throw e;
    }
  }

  async cancel(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.abort();
    } catch (e) {
      log.warn('session.abort failed:', (e as Error).message);
    }
    this.setBusy(false);
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
      this.setBusy(false);
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
