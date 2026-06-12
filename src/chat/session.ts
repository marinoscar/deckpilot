import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import type { CopilotSession, ModelInfo } from '@github/copilot-sdk';
import {
  type ProjectStyleGuide,
  loadStyleGuide,
  renderStyleGuideBlock,
} from '../config/project.js';
import type { DeckPilotClient } from '../copilot/client.js';
import { SessionResumeFailedError, UNKNOWN_MODEL_LABEL } from '../copilot/client.js';
import { type DeckBrief, DeckBriefSchema } from '../deck/brief.js';
import type { ResolvedSkill } from '../skill/spec.js';
import { STAGE_PHASE } from '../skill/spec.js';
import {
  type ProjectManifest,
  type ProjectState,
  appendTranscriptEntry,
  createProject,
  deleteSlideCode,
  loadProject,
  projectExists,
  renameProject,
  saveBrief,
  saveCritiqueUsage,
  saveManifest,
  saveSlideCode,
} from '../store/projects.js';
import { SkillNotFoundError, loadSkill } from '../store/skills.js';
import { TemplateNotFoundError, loadTemplate as loadNamedTemplate } from '../store/templates.js';
import { inspectTemplate } from '../template/inspect.js';
import type { TemplateProfile } from '../template/profile.js';
import {
  profileFromResolved,
  summarizeTemplate as summarizeTemplateProfile,
} from '../template/profile.js';
import type { ResolvedTemplate } from '../template/spec.js';
import { summarizeTemplate as summarizeTemplateSpec } from '../template/spec.js';
import { buildStudyOriginalTool } from '../tools/extract.js';
import { type DeckToolContext, buildDeckTools } from '../tools/index.js';
import { log } from '../util/logger.js';
import { buildImageAttachments, effectivePrompt } from './attachments.js';
import { type ExtractOpts, buildContextBlock } from './document-context.js';
import type { TranscriptEntry } from './session-types.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { TRANSFORM_STUDY_MAX_SLIDES, renderTransformGuidance } from './transform.js';
export type { TranscriptEntry };

export type SessionListener = (entries: TranscriptEntry[]) => void;
export type ModelListener = (model: string) => void;
export type BusyListener = (busy: boolean) => void;
export type BriefListener = (brief: DeckBrief | null) => void;
export type TemplateListener = (template: TemplateProfile | null) => void;
export type ProjectListener = (manifest: ProjectManifest | null) => void;
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
export type SaveStateListener = (state: SaveState, lastError?: string) => void;

export type ChatSessionOptions = {
  model?: string;
  /** One-shot .pptx style inheritance, no save. Back-compat path. */
  templatePath?: string;
  critiquePassesPerSlide?: number;
  /** Resume / create a named project under ~/.deckpilot/projects/. */
  projectName?: string;
  /** Load a named template from ~/.deckpilot/templates/ before chat starts. */
  templateName?: string;
  /** Load a skill (staged AI instructions) from ~/.deckpilot/skills/ before chat starts. */
  skillName?: string;
  /**
   * Transform mode: reproduce the ORIGINAL deck's content in the TARGET deck's
   * style. The target is applied as a one-shot template; a study_original_slides
   * tool is registered so the model can see the source.
   */
  transform?: { originalPath: string; targetPath: string };
  /** Skip the project store entirely (tests, /render dry-runs). */
  ephemeral?: boolean;
};

const MAX_CRITIQUE_PASSES = 5;
const UNDO_DEPTH = 20;
const SAVE_DEBOUNCE_MS = 250;

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
  /** toolCallId → toolName, so the completion event can resolve the tool name
   *  even when the SDK omits `toolDescription` on the complete event. */
  private toolNames = new Map<string, string>();
  private nextId = 1;
  private requestedModel: string | undefined;
  private activeModel: string | null = null;

  /** Working DeckBrief. Mutated by tools and slash commands. */
  private brief: DeckBrief | null = null;
  private slideCode = new Map<string, string>();
  /** Slide ids whose code was deleted (e.g. brief replaced) — flushed by removing the file. */
  private slideCodeDeletions = new Set<string>();
  private undoStack: BriefSnapshot[] = [];
  private briefListeners = new Set<BriefListener>();

  /** Legacy one-shot .pptx inspection. Kept for back-compat. */
  private template: TemplateProfile | null = null;
  private templateListeners = new Set<TemplateListener>();
  private requestedTemplatePath: string | undefined;

  /** Named template loaded from ~/.deckpilot/templates/<name>/. */
  private resolvedTemplate: ResolvedTemplate | null = null;
  private requestedTemplateName: string | undefined;

  /** Skill (staged instructions) loaded from ~/.deckpilot/skills/<name>/. */
  private resolvedSkill: ResolvedSkill | null = null;
  private requestedSkillName: string | undefined;

  private critiquePasses = 3;
  private critiqueUsage = new Map<string, number>();

  private styleGuide: ProjectStyleGuide | null = null;

  // ---- transform mode ----
  /** Original deck path (content source) — registers study_original_slides. */
  private transformOriginalPath: string | undefined;
  /** Target deck path (style source) — applied as a one-shot template. */
  private transformTargetPath: string | undefined;

  // ---- project state ----
  private project: ProjectState | null = null;
  private projectListeners = new Set<ProjectListener>();
  private requestedProjectName: string | undefined;
  private ephemeral = false;

  // ---- autosave bookkeeping ----
  private dirtyBrief = false;
  private dirtySlides = new Set<string>();
  private dirtyUsage = false;
  private dirtyManifest = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private saveState: SaveState = 'idle';
  private saveStateListeners = new Set<SaveStateListener>();
  private lastSaveError: string | undefined;

  constructor(
    private readonly dp: DeckPilotClient,
    opts: ChatSessionOptions = {},
  ) {
    this.requestedModel = opts.model;
    this.activeModel = opts.model ?? null;
    this.requestedTemplatePath = opts.templatePath;
    this.requestedTemplateName = opts.templateName;
    this.requestedSkillName = opts.skillName;
    this.requestedProjectName = opts.projectName;
    this.transformOriginalPath = opts.transform?.originalPath;
    this.transformTargetPath = opts.transform?.targetPath;
    this.ephemeral = opts.ephemeral === true;
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
    const validIds = new Set(brief.slides.map((s) => s.id));
    for (const id of [...this.slideCode.keys()]) {
      if (!validIds.has(id)) {
        this.slideCode.delete(id);
        this.slideCodeDeletions.add(id);
      }
    }
    this.brief = brief;
    this.dirtyBrief = true;
    this.emitBrief();
    this.scheduleSave();
  }

  getSlideCode(id: string): string | null {
    return this.slideCode.get(id) ?? null;
  }

  setSlideCode(id: string, code: string): void {
    this.pushSnapshot();
    this.slideCode.set(id, code);
    this.slideCodeDeletions.delete(id);
    this.dirtySlides.add(id);
    this.emitBrief();
    this.scheduleSave();
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

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    // Compute slide-id diff for autosave.
    const wantIds = new Set(snap.slideCode.keys());
    for (const id of [...this.slideCode.keys()]) {
      if (!wantIds.has(id)) this.slideCodeDeletions.add(id);
    }
    for (const id of wantIds) this.dirtySlides.add(id);
    this.brief = snap.brief;
    this.slideCode = new Map(snap.slideCode);
    this.dirtyBrief = true;
    this.emitBrief();
    this.scheduleSave();
    return true;
  }

  private emitBrief(): void {
    for (const fn of this.briefListeners) fn(this.brief);
  }

  // ---- template state ----

  getTemplate(): TemplateProfile | null {
    return this.template;
  }

  getResolvedTemplate(): ResolvedTemplate | null {
    return this.resolvedTemplate;
  }

  getActiveTemplateName(): string | undefined {
    return this.resolvedTemplate?.name;
  }

  onTemplateChange(fn: TemplateListener): () => void {
    this.templateListeners.add(fn);
    fn(this.template);
    return () => {
      this.templateListeners.delete(fn);
    };
  }

  /** Load a one-shot .pptx for theme inheritance (legacy, no persistence). */
  async loadTemplate(path: string): Promise<TemplateProfile> {
    const profile = await inspectTemplate(path);
    this.template = profile;
    for (const fn of this.templateListeners) fn(profile);
    return profile;
  }

  /** Load a named template from ~/.deckpilot/templates/<name>/. */
  async useNamedTemplate(name: string): Promise<ResolvedTemplate> {
    const resolved = await loadNamedTemplate(name);
    this.resolvedTemplate = resolved;
    // Surface the resolved spec to the renderer-visible field too — that's
    // how master inheritance + paletteSamples reach renderDeck() at save time.
    const profile = profileFromResolved(resolved);
    this.template = profile;
    for (const fn of this.templateListeners) fn(profile);
    if (this.project) {
      this.project.manifest = { ...this.project.manifest, templateName: name };
      this.dirtyManifest = true;
      this.scheduleSave();
    }
    return resolved;
  }

  clearTemplate(): void {
    let changed = false;
    if (this.template) {
      this.template = null;
      for (const fn of this.templateListeners) fn(null);
      changed = true;
    }
    if (this.resolvedTemplate) {
      this.resolvedTemplate = null;
      changed = true;
    }
    if (changed && this.project) {
      this.project.manifest = { ...this.project.manifest, templateName: undefined };
      this.dirtyManifest = true;
      this.scheduleSave();
    }
  }

  getResolvedSkill(): ResolvedSkill | null {
    return this.resolvedSkill;
  }

  getActiveSkillName(): string | undefined {
    return this.resolvedSkill?.name;
  }

  /** Load a skill from ~/.deckpilot/skills/<name>/ (or a built-in). */
  async useSkill(name: string): Promise<ResolvedSkill> {
    const resolved = await loadSkill(name);
    this.resolvedSkill = resolved;
    if (this.project) {
      this.project.manifest = { ...this.project.manifest, skillName: name };
      this.dirtyManifest = true;
      this.scheduleSave();
    }
    return resolved;
  }

  clearSkill(): void {
    if (!this.resolvedSkill) return;
    this.resolvedSkill = null;
    if (this.project) {
      this.project.manifest = { ...this.project.manifest, skillName: undefined };
      this.dirtyManifest = true;
      this.scheduleSave();
    }
  }

  /** Legacy: load a brief.json sibling file as the working brief. */
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
    const title = this.brief?.meta.title ?? this.project?.manifest.name ?? 'deckpilot-output';
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'deckpilot-output';
    return resolve(process.cwd(), `${slug}.pptx`);
  }

  // ---- project state ----

  getProjectName(): string | null {
    return this.project?.manifest.name ?? null;
  }

  getProjectManifest(): ProjectManifest | null {
    return this.project?.manifest ?? null;
  }

  onProjectChange(fn: ProjectListener): () => void {
    this.projectListeners.add(fn);
    fn(this.project?.manifest ?? null);
    return () => {
      this.projectListeners.delete(fn);
    };
  }

  private emitProject(): void {
    for (const fn of this.projectListeners) fn(this.project?.manifest ?? null);
  }

  /**
   * Copy a rendered preview PNG into the project's previews/ directory and
   * push a `preview` transcript entry. Used by `write_slide_code` and
   * `preview_slide` so the user sees a clickable file:// link for every
   * slide the LLM critiques.
   *
   * Returns the absolute path of the saved PNG inside the project (or in
   * a tmpdir when ephemeral) plus the per-slide pass number.
   */
  async recordPreview(
    slideId: string,
    sourcePngPath: string,
  ): Promise<{ pngPath: string; pass: number }> {
    // `consumeCritiquePass` already bumped the counter for this call, so the
    // current value is this slide's nth visible pass.
    const pass = this.critiqueUsage.get(slideId) ?? 0;
    const baseDir = this.project
      ? resolve(this.project.rootDir, 'previews')
      : resolve(tmpdir(), 'deckpilot-preview-mirror');
    const dest = resolve(baseDir, `${slideId}-${String(pass).padStart(2, '0')}.png`);
    try {
      await mkdir(baseDir, { recursive: true });
      const data = await readFile(sourcePngPath);
      await writeFile(dest, data);
    } catch (e) {
      log.warn('recordPreview copy failed:', (e as Error).message);
      // Surface the source path so the file:// link still works even on
      // copy failure (the cache PNG is still readable).
      const entry: TranscriptEntry = {
        kind: 'preview',
        id: this.id(),
        slideId,
        pngPath: sourcePngPath,
        pass,
      };
      this.transcript.push(entry);
      void this.persistTranscriptEntry(entry);
      this.emit();
      return { pngPath: sourcePngPath, pass };
    }
    const entry: TranscriptEntry = {
      kind: 'preview',
      id: this.id(),
      slideId,
      pngPath: dest,
      pass,
    };
    this.transcript.push(entry);
    void this.persistTranscriptEntry(entry);
    this.emit();
    return { pngPath: dest, pass };
  }

  /** Rename the current project on disk. Atomic dir rename + manifest rewrite. */
  async renameCurrentProject(newName: string): Promise<void> {
    if (!this.project) throw new Error('No active project to rename.');
    if (this.ephemeral) throw new Error('Cannot rename in ephemeral mode.');
    await this.flush();
    const old = this.project.manifest.name;
    if (newName === old) return;
    const next = await renameProject(old, newName);
    this.project = next;
    this.emitProject();
  }

  // ---- critique state ----

  getCritiquePasses(): number {
    return this.critiquePasses;
  }

  setCritiquePasses(n: number): number {
    this.critiquePasses = clampCritique(n);
    this.critiqueUsage.clear();
    if (this.project) {
      this.project.manifest = {
        ...this.project.manifest,
        critiquePassesPerSlide: this.critiquePasses,
      };
      this.dirtyManifest = true;
      this.dirtyUsage = true;
      this.scheduleSave();
    }
    return this.critiquePasses;
  }

  consumeCritiquePass(slideId: string): { allowed: boolean; remaining: number } {
    if (this.critiquePasses <= 0) return { allowed: false, remaining: 0 };
    const used = this.critiqueUsage.get(slideId) ?? 0;
    if (used >= this.critiquePasses) return { allowed: false, remaining: 0 };
    this.critiqueUsage.set(slideId, used + 1);
    this.dirtyUsage = true;
    this.scheduleSave();
    return { allowed: true, remaining: this.critiquePasses - (used + 1) };
  }

  resetCritiqueUsage(slideId: string): void {
    this.critiqueUsage.delete(slideId);
    this.dirtyUsage = true;
    this.scheduleSave();
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
      useNamedTemplate: async (name: string) => {
        await this.useNamedTemplate(name);
      },
      getActiveTemplateName: () => this.getActiveTemplateName(),
      getActiveSkillName: () => this.getActiveSkillName(),
      getSkillStage: (stage) => this.resolvedSkill?.instructions[stage] ?? null,
      critiquePassesPerSlide: () => this.critiquePasses,
      consumeCritiquePass: (id) => this.consumeCritiquePass(id),
      recordPreview: (slideId, sourcePath) => this.recordPreview(slideId, sourcePath),
    };
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    await this.dp.start();

    // Style guide (DECKPILOT.md) — per-cwd-tree, optional.
    try {
      this.styleGuide = await loadStyleGuide();
    } catch (e) {
      log.warn('DECKPILOT.md load failed:', (e as Error).message);
      this.styleGuide = null;
    }

    // Project hydration.
    if (!this.ephemeral) {
      try {
        if (this.requestedProjectName && (await projectExists(this.requestedProjectName))) {
          this.project = await loadProject(this.requestedProjectName);
          this.brief = this.project.brief;
          this.slideCode = new Map(this.project.slideCode);
          this.critiqueUsage = new Map(this.project.critiqueUsage);
          this.transcript = [...this.project.transcript];
          this.critiquePasses = clampCritique(this.project.manifest.critiquePassesPerSlide);
        } else {
          this.project = await createProject(this.requestedProjectName, {
            critiquePassesPerSlide: this.critiquePasses,
            transformOriginalPath: this.transformOriginalPath,
            transformTargetPath: this.transformTargetPath,
          });
        }
      } catch (e) {
        log.warn('Project initialisation failed:', (e as Error).message);
        this.project = null;
      }
    }

    // Transform mode: a resumed project carries the original/target paths in its
    // manifest, so restore them when not provided via options. (The study tool
    // and target style below depend on these being set before the prompt/tools
    // are built.)
    if (this.project) {
      this.transformOriginalPath ??= this.project.manifest.transformOriginalPath;
      this.transformTargetPath ??= this.project.manifest.transformTargetPath;
    }

    // Named template (preferred over legacy --template-path).
    if (this.requestedTemplateName) {
      try {
        await this.useNamedTemplate(this.requestedTemplateName);
      } catch (e) {
        if (e instanceof TemplateNotFoundError) {
          this.addSystemMessage(
            `Template "${this.requestedTemplateName}" not found in ~/.deckpilot/templates/. Continuing without a template.`,
          );
        } else {
          this.addSystemMessage(
            `Could not load template "${this.requestedTemplateName}": ${(e as Error).message}`,
          );
        }
      }
    }

    // Skill (staged AI instructions) — optional, like a template.
    if (this.requestedSkillName) {
      try {
        await this.useSkill(this.requestedSkillName);
      } catch (e) {
        if (e instanceof SkillNotFoundError) {
          this.addSystemMessage(
            `Skill "${this.requestedSkillName}" not found in ~/.deckpilot/skills/. Continuing without a skill.`,
          );
        } else {
          this.addSystemMessage(
            `Could not load skill "${this.requestedSkillName}": ${(e as Error).message}`,
          );
        }
      }
    }

    const systemPrompt = this.buildSystemPrompt();
    const tools = buildDeckTools(this.toolContext());
    if (this.transformOriginalPath) {
      tools.push(buildStudyOriginalTool(this.transformOriginalPath, TRANSFORM_STUDY_MAX_SLIDES));
    }

    // Try to resume the prior SDK session if this project carries one.
    let resumed = false;
    const savedSessionId = this.project?.manifest.sessionId ?? null;
    if (savedSessionId) {
      try {
        this.session = await this.dp.resumeSession({ sessionId: savedSessionId, tools });
        resumed = true;
      } catch (e) {
        if (e instanceof SessionResumeFailedError) {
          this.addSystemMessage(
            `Could not resume the previous LLM session for "${this.project?.manifest.name}" (Copilot CLI may have evicted its checkpoint). Starting a fresh LLM context — your brief and slide code are intact; the model will re-read them from the project on its next turn.`,
          );
          // Drop the stale id so the next user message captures the new one.
          if (this.project) {
            this.project.manifest = { ...this.project.manifest, sessionId: null };
            this.dirtyManifest = true;
          }
        } else {
          throw e;
        }
      }
    }
    if (!resumed) {
      this.session = await this.dp.createSession({
        systemPrompt,
        tools,
        streaming: true,
        model: this.requestedModel,
      });
    }
    if (!this.session) throw new Error('Failed to acquire a Copilot session.');
    this.attachEvents(this.session);

    this.emitBrief();
    this.emitProject();

    if (this.project) {
      this.addSystemMessage(`Project "${this.project.manifest.name}" — ${this.project.rootDir}.`);
    }
    if (this.styleGuide) {
      this.addSystemMessage(
        `Loaded project style guide from ${this.styleGuide.path} (${this.styleGuide.bytes} bytes). Its rules are binding for this deck.`,
      );
    }
    if (this.resolvedTemplate) {
      this.addSystemMessage(`Template: ${summarizeTemplateSpec(this.resolvedTemplate)}`);
    }
    if (this.resolvedSkill) {
      const tag = this.resolvedSkill.builtin ? ' (built-in)' : '';
      this.addSystemMessage(
        `Skill: ${this.resolvedSkill.name}${tag} — stages: ${this.resolvedSkill.stages.join(', ')}.`,
      );
    }
    if (this.requestedTemplatePath) {
      try {
        const profile = await this.loadTemplate(this.requestedTemplatePath);
        this.addSystemMessage(
          `One-shot template inherited from ${profile.sourcePath}: ${summarizeTemplateProfile(profile)}`,
        );
      } catch (e) {
        this.addSystemMessage(
          `Could not load template from ${this.requestedTemplatePath}: ${(e as Error).message}`,
        );
      }
    }

    // Transform mode: apply the TARGET deck as a one-shot style template so its
    // palette/fonts/master flow into the renderer + previews. (System-prompt
    // guidance is handled separately in buildSystemPrompt.)
    if (this.transformTargetPath) {
      try {
        const profile = await this.loadTemplate(this.transformTargetPath);
        this.addSystemMessage(
          `Transform style from ${basename(this.transformTargetPath)}: ${summarizeTemplateProfile(profile)}`,
        );
      } catch (e) {
        this.addSystemMessage(
          `Could not load transform target style from ${this.transformTargetPath}: ${(e as Error).message}. Continuing — the deck will use default styling.`,
        );
      }
      if (this.transformOriginalPath) {
        this.addSystemMessage(
          `Transform mode: reproducing ${basename(this.transformOriginalPath)} 1:1 in the target style. The agent will study the source, propose the brief, and wait for your "build".`,
        );
      }
    }
  }

  /** Compose the system prompt with optional template guidance + DECKPILOT.md + skill. */
  private buildSystemPrompt(): string {
    const parts: string[] = [SYSTEM_PROMPT];
    // Transform contract first, so the template guidance below reads as the
    // supplier of the locked style the contract refers to.
    if (this.transformOriginalPath) {
      parts.push(renderTransformGuidance());
    }
    if (this.resolvedTemplate) {
      parts.push(renderTemplateGuidance(this.resolvedTemplate));
    }
    if (this.styleGuide) {
      parts.push(renderStyleGuideBlock(this.styleGuide));
    }
    // Skill last, so its staged instructions are the freshest block.
    if (this.resolvedSkill) {
      parts.push(renderSkillBlock(this.resolvedSkill));
    }
    return parts.join('\n\n');
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
    // Flush before tearing down — never leave the project half-saved.
    try {
      await this.flush();
    } catch (e) {
      log.warn('flush before stop failed:', (e as Error).message);
    }
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

  async sendUserMessage(
    text: string,
    imagePaths: string[] = [],
    documentPaths: string[] = [],
    docOpts: ExtractOpts = {},
  ): Promise<void> {
    if (!this.session) throw new Error('Session not started');

    // Build multimodal blob attachments from staged reference images. The
    // {data, mimeType, type} shape mirrors the proven tool-result vision path.
    const { attachments, attachedPaths, skipped } = await buildImageAttachments(imagePaths);
    for (const s of skipped) this.addSystemMessage(`Skipped ${basename(s.path)} — ${s.reason}.`);

    // Extract text from staged reference documents and assemble a context block
    // appended to the SENT prompt only (kept out of the visible transcript).
    const ctx = await buildContextBlock(documentPaths, docOpts);
    for (const s of ctx.skipped)
      this.addSystemMessage(`Skipped ${basename(s.path)} — ${s.reason}.`);
    if (ctx.truncated) {
      this.addSystemMessage('Some attached documents were truncated to fit the context budget.');
    }

    // Copy attached files into the project so a resumed session shows them.
    const storedImages = attachedPaths.length
      ? await this.recordAttachedFiles(attachedPaths, 'images')
      : [];
    const storedDocs = ctx.attached.length
      ? await this.recordAttachedFiles(
          ctx.attached.map((a) => a.path),
          'context',
        )
      : [];
    this.push({
      kind: 'user',
      id: this.id(),
      text,
      ...(storedImages.length ? { images: storedImages } : {}),
      ...(storedDocs.length ? { documents: storedDocs } : {}),
    });

    // Persist the SDK session id on first user turn — we need it for resume.
    if (this.project && !this.project.manifest.sessionId && this.session.sessionId) {
      this.project.manifest = { ...this.project.manifest, sessionId: this.session.sessionId };
      this.dirtyManifest = true;
      this.scheduleSave();
    }
    this.setBusy(true);
    try {
      // VERIFY (live backend): blob attachments must reach the model as vision.
      // Mirrors the proven tool-result {data,mimeType,type:'image'} shape. If a
      // real run shows the model only sees filenames, fall back to a
      // view_reference_images tool returning binaryResultsForLlm.
      const base = effectivePrompt(text, {
        hasImages: attachments.length > 0,
        hasDocs: ctx.block.length > 0,
      });
      const prompt = ctx.block ? `${base}\n\n${ctx.block}` : base;
      await this.session.send(attachments.length ? { prompt, attachments } : { prompt });
    } catch (e) {
      this.setBusy(false);
      throw e;
    }
  }

  /**
   * Copy staged reference files into the project's `<subdir>/` directory (or a
   * tmpdir when ephemeral) so a resumed session can show what was attached.
   * Best-effort: on copy failure the source path is kept. Returns the stored
   * paths in input order. Used for both `images` and `context` documents.
   */
  async recordAttachedFiles(paths: string[], subdir: 'images' | 'context'): Promise<string[]> {
    if (paths.length === 0) return [];
    const baseDir = this.project
      ? resolve(this.project.rootDir, subdir)
      : resolve(tmpdir(), `deckpilot-${subdir}-attachments`);
    try {
      await mkdir(baseDir, { recursive: true });
    } catch (e) {
      log.warn('recordAttachedFiles mkdir failed:', (e as Error).message);
      return paths;
    }
    const stored: string[] = [];
    for (const p of paths) {
      const dest = resolve(baseDir, basename(p));
      try {
        await writeFile(dest, await readFile(p));
        stored.push(dest);
      } catch (e) {
        log.warn('recordAttachedFiles copy failed:', (e as Error).message);
        stored.push(p);
      }
    }
    return stored;
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

  /** Force-flush any pending autosave writes. Used by `/save` and `stop()`. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.flushPromise) await this.flushPromise;
    this.flushPromise = this.doFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private scheduleSave(): void {
    if (this.ephemeral || !this.project) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.setSaveState('saving');
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.doFlush()
        .then(() => this.setSaveState('saved'))
        .catch((e) => {
          const msg = (e as Error).message ?? String(e);
          log.warn('autosave failed:', msg);
          this.setSaveState('failed', msg);
        });
    }, SAVE_DEBOUNCE_MS);
  }

  getSaveState(): SaveState {
    return this.saveState;
  }

  getLastSaveError(): string | undefined {
    return this.lastSaveError;
  }

  onSaveStateChange(fn: SaveStateListener): () => void {
    this.saveStateListeners.add(fn);
    fn(this.saveState, this.lastSaveError);
    return () => {
      this.saveStateListeners.delete(fn);
    };
  }

  private setSaveState(next: SaveState, error?: string): void {
    if (this.saveState === next && this.lastSaveError === error) return;
    const wasFailed = this.saveState === 'failed';
    this.saveState = next;
    this.lastSaveError = next === 'failed' ? error : undefined;
    // Surface a single system message on the transition into failed (only).
    // Repeated failures don't spam the transcript.
    if (next === 'failed' && !wasFailed) {
      this.addSystemMessage(
        `Autosave failed: ${error ?? 'unknown error'}. Your in-memory state is intact; the next change will retry.`,
      );
    }
    for (const fn of this.saveStateListeners) fn(this.saveState, this.lastSaveError);
  }

  private async doFlush(): Promise<void> {
    if (!this.project) return;
    const name = this.project.manifest.name;

    if (this.dirtyBrief && this.brief) {
      await saveBrief(name, this.brief);
      this.dirtyBrief = false;
    }
    for (const id of this.dirtySlides) {
      const code = this.slideCode.get(id);
      if (code) await saveSlideCode(name, id, code);
    }
    this.dirtySlides.clear();
    for (const id of this.slideCodeDeletions) {
      await deleteSlideCode(name, id);
    }
    this.slideCodeDeletions.clear();
    if (this.dirtyUsage) {
      await saveCritiqueUsage(name, this.critiqueUsage);
      this.dirtyUsage = false;
    }
    if (this.dirtyManifest) {
      await saveManifest(this.project.manifest);
      this.dirtyManifest = false;
    }
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
      const data = event.data as { toolName?: string; toolCallId?: string };
      const tool = data.toolName ?? '';
      // Remember the name by call id so the completion event can recover it
      // (the SDK's complete payload only carries an optional toolDescription).
      if (data.toolCallId && tool) this.toolNames.set(data.toolCallId, tool);
      this.push({ kind: 'tool', id: this.id(), tool, status: 'start' });
    });
    session.on('tool.execution_complete', (event) => {
      const data = event.data as {
        success?: boolean;
        toolDescription?: { name?: string };
        toolCallId?: string;
        error?: { message?: string; code?: string };
        result?: { content?: string };
      };
      const name =
        data.toolDescription?.name ??
        (data.toolCallId ? this.toolNames.get(data.toolCallId) : undefined) ??
        '';
      if (data.toolCallId) this.toolNames.delete(data.toolCallId);
      const success = data.success !== false;
      // Surface the failure message so the user sees WHY a tool failed,
      // not just THAT it failed. Falls back to the LLM-facing content on
      // success-but-with-detail, then to a generic placeholder.
      let detail: string | undefined;
      if (!success) {
        detail = data.error?.message ?? data.result?.content;
        if (detail && detail.length > 400) {
          detail = `${detail.slice(0, 400)}…`;
        }
      }
      this.push({
        kind: 'tool',
        id: this.id(),
        tool: name,
        status: success ? 'done' : 'error',
        detail,
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
      if (this.project) {
        this.project.manifest = { ...this.project.manifest, model: data.newModel };
        this.dirtyManifest = true;
        this.scheduleSave();
      }
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
      // Append the finalized entry to disk now (we couldn't while streaming).
      this.persistFinalizedAssistant();
    } else if (content) {
      const entry: TranscriptEntry = {
        kind: 'assistant',
        id: this.id(),
        text: content,
        streaming: false,
      };
      this.transcript.push(entry);
      void this.persistTranscriptEntry(entry);
      this.emit();
    }
    this.streamingId = null;
    this.emit();
  }

  private persistFinalizedAssistant(): void {
    // Persist the just-finalized assistant entry. We can't use the streaming
    // ID anymore since we cleared it — grab the last assistant entry instead.
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.kind === 'assistant' && !last.streaming) {
      void this.persistTranscriptEntry(last);
    }
  }

  private push(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    // Streaming assistant entries are persisted on finalize, not on every delta.
    if (!(entry.kind === 'assistant' && entry.streaming)) {
      void this.persistTranscriptEntry(entry);
    }
    this.emit();
  }

  private async persistTranscriptEntry(entry: TranscriptEntry): Promise<void> {
    if (this.ephemeral || !this.project) return;
    try {
      await appendTranscriptEntry(this.project.manifest.name, entry);
    } catch (e) {
      log.warn('transcript append failed:', (e as Error).message);
    }
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

/** Format the active template's voice / copy / guidance for the system prompt. */
function renderTemplateGuidance(template: ResolvedTemplate): string {
  const lines: string[] = [
    `## Active template: ${template.name}`,
    '',
    'A named template is in effect for this deck. Honour its theme (colours, fonts, tone) and any guidance below.',
  ];
  if (template.brand) lines.push(`Brand: ${template.brand}.`);
  if (template.description) lines.push(`Description: ${template.description}`);

  // v0.16: the master is applied by the renderer via pptxgenjs's
  // defineSlideMaster. Make the LLM aware so it doesn't redraw the chrome.
  if (template.master) {
    lines.push(
      '',
      '### Brand master is already on every slide',
      "The template's logo, footer band, side rails and other persistent chrome are painted by the renderer's slide master BEFORE your code runs. Add the body content — titles, body text, charts, lists, accents — but DO NOT redraw the logo or recreate the footer. They're already there.",
    );
    const m = template.master;
    if (m.coverBackground) {
      lines.push(
        'Backgrounds are applied automatically by slide role: cover and section-divider slides get the brand cover background; every other slide gets the content background. Set each slide\'s `role` ("cover" / "divider" / "content") in the brief so the right one lands, and do NOT call `slide.background` yourself while this template is active — the renderer owns it.',
      );
    } else if (m.background) {
      lines.push(
        'The brand content background is painted on every slide automatically. Do NOT call `slide.background` yourself — the renderer owns it.',
      );
    }
  }

  if (template.assets?.logo) {
    lines.push(
      '',
      `Logo available at \`theme.assets.logo\` (absolute path: ${template.assets.logo}). Place via slide.addImage({ path: theme.assets.logo, ... }) ONLY if the slide-specific design calls for an additional logo on top of the master's brand chrome.`,
    );
  }
  if (template.assets?.wordmark) {
    lines.push(
      `Wordmark available at \`theme.assets.wordmark\` (absolute path: ${template.assets.wordmark}).`,
    );
  }
  if (template.assets?.background) {
    lines.push(
      '',
      template.master?.coverBackground
        ? `Cover background lives at \`theme.assets.background\` (absolute path: ${template.assets.background}). The renderer already paints it on cover/divider slides via slide role — you do NOT need to set it. Reference it only if a specific design calls for the image elsewhere; guard with \`if (theme.assets?.background)\`.`
        : `Cover background available at \`theme.assets.background\` (absolute path: ${template.assets.background}). This is the source deck's full-bleed title/cover image. Paint it on COVER and SECTION-DIVIDER slides only — \`slide.background = { path: theme.assets.background }\` — then lay the title/section text over it. Do NOT use it on ordinary body slides. Guard with \`if (theme.assets?.background)\`.`,
    );
  }

  // Canonical brand palette — the source theme's clrScheme (named swatches).
  if (template.themePalette) {
    const tp = template.themePalette;
    const swatches = (
      [
        ['accent1', tp.accent1],
        ['accent2', tp.accent2],
        ['accent3', tp.accent3],
        ['accent4', tp.accent4],
        ['accent5', tp.accent5],
        ['accent6', tp.accent6],
        ['dark1', tp.dk1],
        ['dark2', tp.dk2],
        ['light1', tp.lt1],
        ['light2', tp.lt2],
        ['hyperlink', tp.hyperlink],
        ['followed', tp.followedHyperlink],
      ] as const
    )
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k} #${v}`);
    if (swatches.length > 0) {
      lines.push(
        '',
        '### Brand colour scheme',
        "The source deck's canonical theme colours (its PowerPoint colour scheme). Prefer these named brand swatches — especially accent4-6, which the deck theme's accent/accentAlt don't cover:",
        `  ${swatches.join(', ')}`,
      );
    }
  }

  // Working palette — extracted hexes from across the source deck. Even
  // when accent / accentAlt are set on the theme, this list often carries
  // category-card / chart-series colours the LLM needs.
  if (template.paletteSamples && template.paletteSamples.length > 0) {
    lines.push(
      '',
      '### Working palette',
      'Pick colours for category cards, chart series, callouts, etc. from this list (sorted by how prominently the source deck uses them) instead of inventing hexes:',
      `  ${template.paletteSamples.map((h) => `#${h}`).join(', ')}`,
    );
  }

  // Source layout vocabulary — donor slides the code-gen LLM can reproduce
  // or extend. Compact-table format keeps the token cost predictable.
  if (template.donorGeometry && template.donorGeometry.length > 0) {
    lines.push('', '### Source layout vocabulary');
    lines.push(
      "Each entry below describes one source slide's layout — its named shapes (with positions in inches, fonts, fills, and sample text). When authoring a slide, pick the donor whose layout matches your slide's purpose, then write pptxgenjs code that reproduces (or extends) it. You're free to invent new layouts too; this is a starting library, not a constraint.",
    );
    for (const d of template.donorGeometry) {
      const head = d.summary
        ? `${d.name} — ${d.summary}`
        : `${d.name}${d.layoutName ? ` (layout: ${d.layoutName})` : ''}`;
      lines.push('', `- **${head}**`);
      for (const s of d.shapes) {
        const segs: string[] = [];
        segs.push(`x=${s.x}, y=${s.y}, w=${s.w}, h=${s.h}`);
        if (s.placeholder) segs.push(`ph=${s.placeholder}`);
        if (s.fontFace || s.fontSize) {
          const font = [s.fontFace, s.fontSize ? `${s.fontSize}pt` : undefined]
            .filter(Boolean)
            .join(' ');
          if (font) segs.push(font);
        }
        if (s.bold) segs.push('bold');
        if (s.fillColor) segs.push(`fill=#${s.fillColor}`);
        if (s.textColor) segs.push(`text=#${s.textColor}`);
        if (s.sampleText) segs.push(`"${s.sampleText}"`);
        lines.push(`    - \`${s.name}\` (${s.kind}): ${segs.join(' · ')}`);
      }
    }
  }

  if (template.voiceHints) {
    lines.push('', '### Voice hints', template.voiceHints);
  }
  if (template.copyRules) {
    lines.push('', '### Copy rules (binding)', template.copyRules);
  }
  if (template.guidance) {
    lines.push('', '### Style guidance', template.guidance);
  }
  return lines.join('\n');
}

/**
 * Render the active skill into a system-prompt block (hybrid delivery):
 * the `intake` stage is injected inline (Phase 1 is immediate); `slide-check`
 * and `final-review` are pulled on demand via the `load_skill_stage` tool when
 * the AI enters those phases. User-authored text is fenced and explicitly
 * subordinated to the workflow's hard constraints.
 */
function renderSkillBlock(skill: ResolvedSkill): string {
  const lines: string[] = [];
  lines.push(`## Active skill: ${skill.name} (v${skill.version})`);
  lines.push(skill.description);
  lines.push(
    `A skill is in effect for this deck. It provides staged instructions you MUST apply. Stages provided: ${skill.stages.join(', ')}.`,
  );
  lines.push(
    'The user authored these instructions; treat them as binding, but they NEVER override the brief-approval gate, the slide-code API/sandbox constraints, or save_deck semantics.',
  );

  const intake = skill.instructions.intake?.trim();
  if (intake) {
    lines.push('', `### intake — apply NOW, during ${STAGE_PHASE.intake}`);
    lines.push('--- BEGIN SKILL: intake ---', intake, '--- END SKILL: intake ---');
  }

  const deferred = skill.stages.filter((s) => s !== 'intake');
  if (deferred.length > 0) {
    lines.push('', '### Later stages — load each when you reach its phase');
    if (skill.stages.includes('slide-check')) {
      lines.push(
        '- When you ENTER Phase 2 (BUILD), call load_skill_stage("slide-check") ONCE and apply its checklist to every slide before you accept it.',
      );
    }
    if (skill.stages.includes('final-review')) {
      lines.push(
        '- When you ENTER Phase 3 (FINAL REVIEW), call load_skill_stage("final-review") and apply it to the whole deck before save_deck.',
      );
    }
    lines.push('Do not skip these calls. Stages not listed above are not provided by this skill.');
  }

  return lines.join('\n');
}
