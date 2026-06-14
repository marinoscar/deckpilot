import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeckBriefSchema } from '../src/deck/brief.js';
import { projectDir } from '../src/store/paths.js';
import {
  ProjectExistsError,
  ProjectNotFoundError,
  appendTranscriptEntry,
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  projectExists,
  renameProject,
  saveBrief,
  saveCritiqueUsage,
  saveManifest,
  saveSlideCode,
} from '../src/store/projects.js';

const FIXTURE_BRIEF = DeckBriefSchema.parse({
  meta: { title: 'Fixture Deck' },
  theme: { accent: '1A2B5E', accentAlt: 'C8202E' },
  slides: [
    { id: 'cover', title: 'Cover', purpose: 'Open the deck.' },
    { id: 'two', title: 'Two', purpose: 'Body.' },
  ],
});

describe('projects store', () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'deckpilot-projects-'));
    process.env.DECKPILOT_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.DECKPILOT_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('createProject with a name produces a fresh manifest + dir', async () => {
    const p = await createProject('hello-world');
    expect(p.manifest.name).toBe('hello-world');
    expect(p.manifest.sessionId).toBeNull();
    expect(p.brief).toBeNull();
    expect(p.slideCode.size).toBe(0);
    expect(existsSync(join(p.rootDir, 'project.json'))).toBe(true);
    expect(existsSync(join(p.rootDir, 'slides'))).toBe(true);
  });

  it('createProject persists improveSourcePath on the manifest', async () => {
    const p = await createProject('imp', { improveSourcePath: '/decks/src.pptx' });
    expect(p.manifest.improveSourcePath).toBe('/decks/src.pptx');
    const loaded = await loadProject('imp');
    expect(loaded.manifest.improveSourcePath).toBe('/decks/src.pptx');
  });

  it('createProject auto-allocates project-N when name is omitted', async () => {
    const a = await createProject();
    const b = await createProject();
    expect(a.manifest.name).toBe('project-1');
    expect(b.manifest.name).toBe('project-2');
  });

  it('createProject refuses bad names', async () => {
    await expect(createProject('Acme Corp!')).rejects.toThrow(/lower-case kebab/);
  });

  it('createProject refuses to clobber an existing project', async () => {
    await createProject('twice');
    await expect(createProject('twice')).rejects.toThrow(ProjectExistsError);
  });

  it('round-trips brief + slide code + critique usage + transcript', async () => {
    const p = await createProject('rt');

    await saveBrief('rt', FIXTURE_BRIEF);
    await saveSlideCode('rt', 'cover', 'function render(slide, theme, helpers) {}');
    await saveSlideCode('rt', 'two', 'slide.addText("hi", { x:0, y:0, w:1, h:1 });');
    await saveCritiqueUsage(
      'rt',
      new Map([
        ['cover', 2],
        ['two', 1],
      ]),
    );
    await appendTranscriptEntry('rt', { kind: 'user', id: 'e1', text: 'hello' });
    await appendTranscriptEntry('rt', {
      kind: 'assistant',
      id: 'e2',
      text: 'hi',
      streaming: false,
    });

    const loaded = await loadProject('rt');
    expect(loaded.brief?.meta.title).toBe('Fixture Deck');
    expect(loaded.slideCode.get('cover')).toContain('function render');
    expect(loaded.slideCode.get('two')).toContain('addText');
    expect(loaded.critiqueUsage.get('cover')).toBe(2);
    expect(loaded.transcript).toHaveLength(2);
    expect(loaded.transcript[0]).toMatchObject({ kind: 'user', text: 'hello' });
  });

  it('listProjects returns most-recently-updated first', async () => {
    await createProject('alpha');
    // small wait via Date manipulation through saveManifest
    const b = await createProject('beta');
    await saveManifest({ ...b.manifest });
    const list = await listProjects();
    expect(list.map((e) => e.name)).toEqual(['beta', 'alpha']);
  });

  it('renames a project and rewrites the manifest name', async () => {
    await createProject('old-name');
    const renamed = await renameProject('old-name', 'new-name');
    expect(renamed.manifest.name).toBe('new-name');
    expect(existsSync(projectDir('old-name'))).toBe(false);
    expect(existsSync(projectDir('new-name'))).toBe(true);
  });

  it('renameProject refuses to clobber an existing target', async () => {
    await createProject('a');
    await createProject('b');
    await expect(renameProject('a', 'b')).rejects.toThrow(ProjectExistsError);
  });

  it('deleteProject removes the directory', async () => {
    await createProject('doomed');
    await deleteProject('doomed');
    expect(await projectExists('doomed')).toBe(false);
    await expect(loadProject('doomed')).rejects.toThrow(ProjectNotFoundError);
  });

  it('loadProject skips malformed transcript lines rather than throwing', async () => {
    const p = await createProject('torn');
    await appendTranscriptEntry('torn', { kind: 'user', id: 'e1', text: 'one' });
    // Inject a torn line manually
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(p.rootDir, 'transcript.jsonl'), 'not-json\n');
    await appendTranscriptEntry('torn', { kind: 'user', id: 'e2', text: 'three' });
    const loaded = await loadProject('torn');
    expect(loaded.transcript.map((t) => (t as { text?: string }).text)).toEqual(['one', 'three']);
  });
});
