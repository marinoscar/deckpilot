import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PICKER_PAGE_SIZE, pickerLayout, scanWorkspaceFiles } from '../src/util/files.js';

describe('pickerLayout', () => {
  it('PICKER_PAGE_SIZE is 5', () => {
    expect(PICKER_PAGE_SIZE).toBe(5);
  });

  it('empty list: just the Type-a-path row', () => {
    expect(pickerLayout(0, 0)).toMatchObject({
      pageCount: 1,
      pageStart: 0,
      pageLen: 0,
      hasMore: false,
      showMoreIndex: -1,
      manualIndex: 0,
      count: 1,
    });
  });

  it('fits on one page (≤5): no Show-more row', () => {
    expect(pickerLayout(3, 0)).toMatchObject({
      pageCount: 1,
      pageLen: 3,
      hasMore: false,
      showMoreIndex: -1,
      manualIndex: 3,
      count: 4,
    });
    // Exactly PICKER_PAGE_SIZE is still one page.
    expect(pickerLayout(5, 0)).toMatchObject({ hasMore: false, manualIndex: 5, count: 6 });
  });

  it('overflows: adds a Show-more row before Type-a-path', () => {
    expect(pickerLayout(6, 0)).toMatchObject({
      pageCount: 2,
      pageStart: 0,
      pageLen: 5,
      hasMore: true,
      showMoreIndex: 5,
      manualIndex: 6,
      count: 7,
    });
  });

  it('last (partial) page reports the right slice + row indices', () => {
    expect(pickerLayout(6, 1)).toMatchObject({
      pageCount: 2,
      pageStart: 5,
      pageLen: 1,
      hasMore: true,
      showMoreIndex: 1,
      manualIndex: 2,
      count: 3,
    });
    expect(pickerLayout(12, 2)).toMatchObject({ pageCount: 3, pageStart: 10, pageLen: 2 });
  });
});

describe("scanWorkspaceFiles — kinds:'all'", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deckpilot-scan-all-'));
    for (const name of ['a.txt', 'b.ts', 'c.pptx', 'data.csv']) {
      writeFileSync(join(dir, name), 'x');
    }
    writeFileSync(join(dir, '.hidden'), 'x');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'dep.js'), 'x');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'nested.txt'), 'x');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('surfaces every non-hidden file in the folder (incl. .ts/.csv the default scan hides)', async () => {
    const names = (await scanWorkspaceFiles(dir, { kinds: 'all' })).map((f) => f.name).sort();
    expect(names).toEqual(['a.txt', 'b.ts', 'c.pptx', 'data.csv']);
  });

  it('still excludes hidden files, node_modules, and non-recursive subdirs', async () => {
    const names = (await scanWorkspaceFiles(dir, { kinds: 'all' })).map((f) => f.name);
    expect(names).not.toContain('.hidden');
    expect(names).not.toContain('dep.js');
    expect(names).not.toContain('nested.txt');
  });

  it('classifies unknown extensions as "other"', async () => {
    const files = await scanWorkspaceFiles(dir, { kinds: 'all' });
    expect(files.find((f) => f.name === 'b.ts')?.kind).toBe('other');
    expect(files.find((f) => f.name === 'c.pptx')?.kind).toBe('pptx');
  });
});
