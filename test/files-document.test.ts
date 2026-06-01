import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_ATTACHED_DOCUMENTS,
  mergeDocuments,
  scanWorkspaceFiles,
  toggleDocument,
} from '../src/util/files.js';

describe('scanWorkspaceFiles — document vs default kinds', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deckpilot-scan-doc-'));
    for (const name of ['a.txt', 'b.md', 'c.docx', 'd.pptx', 'e.png', 'f.json']) {
      writeFileSync(join(dir, name), 'x');
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("kinds:'documents' surfaces only document files", async () => {
    const files = await scanWorkspaceFiles(dir, { kinds: 'documents' });
    expect(files.map((f) => f.name).sort()).toEqual(['a.txt', 'b.md', 'c.docx', 'd.pptx']);
  });

  it('classifies kinds correctly (txt/md/docx → document, pptx → pptx)', async () => {
    const files = await scanWorkspaceFiles(dir, { kinds: 'documents' });
    const kind = (n: string) => files.find((f) => f.name === n)?.kind;
    expect(kind('a.txt')).toBe('document');
    expect(kind('b.md')).toBe('document');
    expect(kind('c.docx')).toBe('document');
    expect(kind('d.pptx')).toBe('pptx'); // a pptx is still a pptx in both pickers
  });

  it('the default scan never surfaces .md/.docx (the @-picker guarantee)', async () => {
    const files = await scanWorkspaceFiles(dir);
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['d.pptx', 'f.json']); // pptx + json stay; md/docx/png excluded
  });
});

describe('toggleDocument / mergeDocuments cap', () => {
  it('caps the staged document list at MAX_ATTACHED_DOCUMENTS', () => {
    const full = Array.from({ length: MAX_ATTACHED_DOCUMENTS }, (_, i) => `d${i}.docx`);
    expect(toggleDocument(full, 'extra.docx')).toEqual(full);
    expect(mergeDocuments([], [...full, 'over.docx'])).toHaveLength(MAX_ATTACHED_DOCUMENTS);
  });

  it('toggles and merges like the image helpers', () => {
    expect(toggleDocument(['a.txt'], 'a.txt')).toEqual([]);
    expect(mergeDocuments(['a.txt'], ['b.md', 'a.txt'])).toEqual(['a.txt', 'b.md']);
  });
});
