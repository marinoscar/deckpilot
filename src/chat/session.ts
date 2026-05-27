import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CopilotSession, ModelInfo } from '@github/copilot-sdk';
import {
  type ProjectStyleGuide,
  loadStyleGuide,
  renderStyleGuideBlock,
} from '../config/project.js';
import type { DeckPilotClient } from '../copilot/client.js';
import { UNKNOWN_MODEL_LABEL } from '../copilot/client.js';
import { type DeckBrief, DeckBriefSchema } from '../deck/brief.js';
import { inspectTemplate } from '../template/inspect.js';
import type { TemplateProfile } from '../template/profile.js';
import { summarizeTemplate } from '../template/profile.js';
import { type DeckToolContext, buildDeckTools } from '../tools/index.js';
import { log } from '../util/logger.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import type { TranscriptEntry } from './session-types.js';
export type { TranscriptEntry };

export type SessionListener = (entries: TranscriptEntry[]) => void;
export type ModelListener = (model: string) => void;
export type BusyListener = (busy: boolean) => void;
export type BriefListener = (brief: DeckBrief | null) => void;
export type TemplateListener = (template: TemplateProfile | null) => void;

export type ChatSessionOptions = {
  model?: string;
  templatePath?: string;
  critiquePassesPerSlide?: number;
};

const MAX_CRITIQUE_PASSES = 5;
const UNDO_DEPTH = 20;

type BriefSnapshot = {
  brief: DeckBrief | null;
  slideCode: Map<string, string>;
};

export class ChatSession {
  private transcript: TranscriptEntry[] = [];
  private listeners = new Set<SessionListener>();
  private modelListeners = new Set<ModelListener>();
  private busyListeners = new Set<BusyListener>();
  private busy = false;
  private session: CopilotSession | null = null;
  private streamingId: string | null = null;
  private nextId = 1;
  private requestedModel: string | undefined;
  private activeModel: string | null = null;

  /** Working DeckBrief. Mutated by tools and slash commands. */
  private brief: DeckBrief | null = null;
  /** Per-slide LLM-generated rendering code, keyed by slide id. */
  private slideCode = new Map<string, string>();
  /** Snapshot stack for `/undo`. Captures both brief and code map. */
  private undoStack: BriefSnapshot[] = [];
  private briefListeners = new Set<BriefListener>();

  private template: TemplateProfile | null = null;
  private templateListeners = new Set<TemplateListener>();
  private requestedTemplatePath: string | undefined;

  private critiquePasses = 3;
  private critiqueUsage = new Map<string, number>();

  private styleGuide: ProjectStyleGuide | null = null;

  constructor(
    private readonly dp: DeckPilotClient,
    opts: ChatSessionOptions = {},
  ) {
    this.requestedModel = opts.model;
    this.activeModel = opts.model ?? null;
    this.requestedTemplatePath = opts.templatePath;
    if (typeof opts.critiquePassesPerSlide === 'number') {
      this.critiquePasses = clampCritique(opts.critiquePassesPerSlide);
    }
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

  getBrief(): DeckBrief | null {
    return this.brief;
  }

  onBriefChange(fn: BriefListener): () => void {
    this.briefListeners.add(fn);
    fn(this.brief);
    return () => {
      this.briefListeners.delete(fn);
    };
  }

  setBrief(brief: DeckBrief): void {
    this.pushSnapshot();
    // Replacing the brief drops slide code whose ids no longer exist.
    const validIds = new Set(brief.slides.map((s) => s.id));
    for (const id of [...this.slideCode.keys()]) {
      if (!validIds.has(id)) this.slideCode.delete(id);
    }
    this.brief = brief;
    this.emitBrief();
  }

  getSlideCode(id: string): string | null {
    return this.slideCode.get(id) ?? null;
  }

  setSlideCode(id: string, code: string): void {
    this.pushSnapshot();
    this.slideCode.set(id, code);
    this.emitBrief();
  }

  getAllSlideCode(): ReadonlyMap<string, string> {
    return this.slideCode;
  }

  private pushSnapshot(): void {
    this.undoStack.push({
      brief: this.brief,
      slideCode: new Map(this.slideCode),
    });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
  }

  /** Roll back one revision. Returns true if anything was undone. */
  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.brief = snap.brief;
    this.slideCode = new Map(snap.slideCode);
    this.emitBrief();
    return true;
  }

  private emitBrief(): void {
    for (const fn of this.briefListeners) fn(this.brief);
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
   * Load a previously-saved DeckPilot `.brief.json` as the working brief. The
   * file MUST validate against the current schema; slide code is NOT loaded
   * by this entry point — call /load-slides separately if you have the .ts
   * files saved alongside.
   */
  async loadBriefFromFile(path: string): Promise<DeckBrief> {
    const raw = await readFile(resolve(process.cwd(), path), 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
    }
    const parsed = DeckBriefSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `DeckBrief in ${path} failed validation:\n${parsed.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      );
    }
    this.setBrief(parsed.data);
    return parsed.data;
  }

  defaultOutputPath(): string {
    const title = this.brief?.meta.title ?? 'deckpilot-output';
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'deckpilot-output';
    return resolve(process.cwd(), `${slug}.pptx`);
  }

  // ---- critique state ----

  getCritiquePasses(): number {
    return this.critiquePasses;
  }

  setCritiquePasses(n: number): number {
    this.critiquePasses = clampCritique(n);
    this.critiqueUsage.clear();
    return this.critiquePasses;
  }

  consumeCritiquePass(slideId: string): { allowed: boolean; remaining: number } {
    if (this.critiquePasses <= 0) return { allowed: false, remaining: 0 };
    const used = this.critiqueUsage.get(slideId) ?? 0;
    if (used >= this.critiquePasses) return { allowed: false, remaining: 0 };
    this.critiqueUsage.set(slideId, used + 1);
    return { allowed: true, remaining: this.critiquePasses - (used + 1) };
  }

  resetCritiqueUsage(slideId: string): void {
    this.critiqueUsage.delete(slideId);
  }

  // ---- project style guide ----

  getStyleGuide(): ProjectStyleGuide | null {
    return this.styleGuide;
  }

  async reloadStyleGuide(startDir?: string): Promise<ProjectStyleGuide | null> {
    this.styleGuide = await loadStyleGuide(startDir);
    return this.styleGuide;
  }

  private toolContext(): DeckToolContext {
    return {
      getBrief: () => this.brief,
      setBrief: (b) => this.setBrief(b),
      getSlideCode: (id) => this.getSlideCode(id),
      setSlideCode: (id, code) => this.setSlideCode(id, code),
      getAllSlideCode: () => this.slideCode,
      defaultOutputPath: () => this.defaultOutputPath(),
      getTemplate: () => this.template,
      loadTemplate: (p) => this.loadTemplate(p),
      critiquePassesPerSlide: () => this.critiquePasses,
      consumeCritiquePass: (id) => this.consumeCritiquePass(id),
    };
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    await this.dp.start();
    try {
      this.styleGuide = await loadStyleGuide();
    } catch (e) {
      log.warn('DECKPILOT.md load failed:', (e as Error).message);
      this.styleGuide = null;
    }
    const systemPrompt = this.styleGuide
      ? `${SYSTEM_PROMPT}\n\n${renderStyleGuideBlock(this.styleGuide)}`
      : SYSTEM_PROMPT;

    this.session = await this.dp.createSession({
      systemPrompt,
      tools: buildDeckTools(this.toolContext()),
      streaming: true,
      model: this.requestedModel,
    });
    this.attachEvents(this.session);

    if (this.styleGuide) {
      this.addSystemMessage(
        `Loaded project style guide from ${this.styleGuide.path} (${this.styleGuide.bytes} bytes). Its rules are binding for this deck.`,
      );
    }
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

function clampCritique(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > MAX_CRITIQUE_PASSES) return MAX_CRITIQUE_PASSES;
  return Math.floor(n);
}
