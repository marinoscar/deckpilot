/**
 * Project store — CRUD over `~/.deckpilot/projects/<slug>/`.
 *
 *   project.json        # manifest (validated)
 *   brief.json          # current DeckBrief (or absent)
 *   slides/<id>.slide.ts# one file per slide that has LLM-written code
 *   transcript.jsonl    # append-only TranscriptEntry stream
 *   critique-usage.json # { slideId: passesUsed }
 *
 * On-disk format is hand-editable — JSON / plain TypeScript only. Writes
 * use the `<file>.tmp → rename` atomic pattern so an interrupted save
 * never leaves a half-written manifest.
 */
import { existsSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { DeckBriefSchema, formatZodError, type DeckBrief } from '../deck/brief.js';
import type { TranscriptEntry } from '../chat/session-types.js';
import { projectDir, projectsRoot, slugify } from './paths.js';

export class ProjectNotFoundError extends Error {
  constructor(name: string) {
    super(`Project "${name}" not found at ${projectDir(name)}.`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectExistsError extends Error {
  constructor(name: string) {
    super(`Project "${name}" already exists.`);
    this.name = 'ProjectExistsError';
  }
}

// ---------- manifest ----------

export const ProjectManifestSchema = z.object({
  schemaVersion: z.literal('1.0').default('1.0'),
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Copilot SDK session id once a session is created — null on a brand-new project. */
  sessionId: z.string().nullable().default(null),
  templateName: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  model: z.string().min(1).max(64).optional(),
  critiquePassesPerSlide: z.number().int().min(0).max(5).default(3),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export type ProjectState = {
  manifest: ProjectManifest;
  brief: DeckBrief | null;
  slideCode: Map<string, string>;
  critiqueUsage: Map<string, number>;
  transcript: TranscriptEntry[];
  rootDir: string;
};

// ---------- listing ----------

export type ProjectListEntry = {
  name: string;
  manifest: ProjectManifest;
  rootDir: string;
};

export async function listProjects(): Promise<ProjectListEntry[]> {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const dirents = await readdir(root, { withFileTypes: true });
  const entries: ProjectListEntry[] = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    try {
      const manifest = await readManifest(d.name);
      entries.push({ name: d.name, manifest, rootDir: projectDir(d.name) });
    } catch {
      // Skip broken projects so a corrupt manifest doesn't tank the list.
    }
  }
  // Most recently updated first — what `resume` users care about.
  entries.sort((a, b) => (b.manifest.updatedAt > a.manifest.updatedAt ? 1 : -1));
  return entries;
}

// ---------- create / load / save / rename / delete ----------

/**
 * Create a new project on disk. If `name` is omitted or already taken,
 * auto-allocate `project-N` starting from the next free index.
 */
export async function createProject(
  name?: string,
  opts: { templateName?: string; model?: string; critiquePassesPerSlide?: number } = {},
): Promise<ProjectState> {
  const slug = await allocateSlug(name);
  const dir = projectDir(slug);
  await mkdir(join(dir, 'slides'), { recursive: true });

  const now = new Date().toISOString();
  const manifest = ProjectManifestSchema.parse({
    name: slug,
    createdAt: now,
    updatedAt: now,
    sessionId: null,
    templateName: opts.templateName,
    model: opts.model,
    critiquePassesPerSlide: opts.critiquePassesPerSlide ?? 3,
  });
  await atomicWriteJson(join(dir, 'project.json'), manifest);

  return {
    manifest,
    brief: null,
    slideCode: new Map(),
    critiqueUsage: new Map(),
    transcript: [],
    rootDir: dir,
  };
}

export async function loadProject(name: string): Promise<ProjectState> {
  const dir = projectDir(name);
  if (!existsSync(dir)) throw new ProjectNotFoundError(name);
  const manifest = await readManifest(name);

  // Brief is optional — early-stage projects may have one queued in chat but
  // never accepted by the LLM.
  let brief: DeckBrief | null = null;
  const briefPath = join(dir, 'brief.json');
  if (existsSync(briefPath)) {
    const raw = await readFile(briefPath, 'utf8');
    const parsed = DeckBriefSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `Project "${name}" has invalid brief.json:\n${formatZodError(parsed.error)}`,
      );
    }
    brief = parsed.data;
  }

  const slideCode = new Map<string, string>();
  const slidesDir = join(dir, 'slides');
  if (existsSync(slidesDir)) {
    const slideFiles = await readdir(slidesDir);
    for (const f of slideFiles) {
      const m = f.match(/^(.+)\.slide\.ts$/);
      if (!m) continue;
      const code = await readFile(join(slidesDir, f), 'utf8');
      slideCode.set(m[1]!, code);
    }
  }

  const critiqueUsage = new Map<string, number>();
  const usagePath = join(dir, 'critique-usage.json');
  if (existsSync(usagePath)) {
    const raw = await readFile(usagePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') critiqueUsage.set(k, v);
    }
  }

  const transcript: TranscriptEntry[] = [];
  const transcriptPath = join(dir, 'transcript.jsonl');
  if (existsSync(transcriptPath)) {
    const raw = await readFile(transcriptPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        transcript.push(JSON.parse(trimmed) as TranscriptEntry);
      } catch {
        // Skip malformed lines — better to lose a torn entry than the whole transcript.
      }
    }
  }

  return { manifest, brief, slideCode, critiqueUsage, transcript, rootDir: dir };
}

// ---------- partial saves (called by ChatSession's autosave) ----------

/** Rewrite the manifest, bumping updatedAt. */
export async function saveManifest(manifest: ProjectManifest): Promise<void> {
  const updated = { ...manifest, updatedAt: new Date().toISOString() };
  const parsed = ProjectManifestSchema.safeParse(updated);
  if (!parsed.success) {
    throw new Error(`Manifest failed validation:\n${formatZodError(parsed.error)}`);
  }
  await atomicWriteJson(join(projectDir(manifest.name), 'project.json'), parsed.data);
}

export async function saveBrief(name: string, brief: DeckBrief): Promise<void> {
  const dir = projectDir(name);
  await mkdir(dir, { recursive: true });
  await atomicWriteJson(join(dir, 'brief.json'), brief);
}

export async function saveSlideCode(
  name: string,
  slideId: string,
  code: string,
): Promise<void> {
  const slidesDir = join(projectDir(name), 'slides');
  await mkdir(slidesDir, { recursive: true });
  await atomicWriteText(join(slidesDir, `${slideId}.slide.ts`), code);
}

export async function deleteSlideCode(name: string, slideId: string): Promise<void> {
  const file = join(projectDir(name), 'slides', `${slideId}.slide.ts`);
  if (existsSync(file)) await rm(file);
}

export async function saveCritiqueUsage(
  name: string,
  usage: ReadonlyMap<string, number>,
): Promise<void> {
  const obj: Record<string, number> = {};
  for (const [k, v] of usage) obj[k] = v;
  await atomicWriteJson(join(projectDir(name), 'critique-usage.json'), obj);
}

/** Append one TranscriptEntry to transcript.jsonl. Cheap; called frequently. */
export async function appendTranscriptEntry(
  name: string,
  entry: TranscriptEntry,
): Promise<void> {
  const file = join(projectDir(name), 'transcript.jsonl');
  await mkdir(projectDir(name), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`);
}

// ---------- rename / delete ----------

export async function renameProject(from: string, to: string): Promise<ProjectState> {
  const slug = slugify(to);
  if (!slug || slug !== to) {
    throw new Error(`Bad project name "${to}". Use lower-case kebab (try: ${slug}).`);
  }
  if (slug === from) {
    return loadProject(from);
  }
  if (existsSync(projectDir(slug))) {
    throw new ProjectExistsError(slug);
  }
  if (!existsSync(projectDir(from))) {
    throw new ProjectNotFoundError(from);
  }
  await rename(projectDir(from), projectDir(slug));
  // Rewrite the manifest's `name` field so it matches the new dir.
  const manifest = await readManifest(slug);
  manifest.name = slug;
  await saveManifest(manifest);
  return loadProject(slug);
}

export async function deleteProject(name: string): Promise<void> {
  const dir = projectDir(name);
  if (!existsSync(dir)) throw new ProjectNotFoundError(name);
  await rm(dir, { recursive: true, force: true });
}

// ---------- helpers ----------

async function readManifest(name: string): Promise<ProjectManifest> {
  const file = join(projectDir(name), 'project.json');
  if (!existsSync(file)) throw new ProjectNotFoundError(name);
  const raw = await readFile(file, 'utf8');
  const parsed = ProjectManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Project "${name}" manifest failed validation:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

async function allocateSlug(name: string | undefined): Promise<string> {
  const root = projectsRoot();
  await mkdir(root, { recursive: true });
  if (name) {
    const slug = slugify(name);
    if (!slug || slug !== name) {
      throw new Error(`Bad project name "${name}". Use lower-case kebab (try: ${slug || '<your-name>'}).`);
    }
    if (existsSync(projectDir(slug))) {
      throw new ProjectExistsError(slug);
    }
    return slug;
  }
  // Auto-allocate project-1, project-2, …
  const existing = await readdir(root);
  let n = 1;
  while (existing.includes(`project-${n}`)) n++;
  return `project-${n}`;
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function atomicWriteText(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(tmp, contents);
  await rename(tmp, path);
}

export async function projectExists(name: string): Promise<boolean> {
  try {
    await stat(join(projectDir(name), 'project.json'));
    return true;
  } catch {
    return false;
  }
}
