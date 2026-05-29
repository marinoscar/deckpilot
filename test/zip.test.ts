import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listZipEntries, packDirectory, readZipEntry, unpackZip } from '../src/util/zip.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-zip-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeFixture(name: string): string {
  const dir = mkdtempSync(join(root, `${name}-`));
  writeFileSync(join(dir, 'template.json'), JSON.stringify({ name, hello: 'world' }, null, 2));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'logo.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  writeFileSync(join(dir, 'assets', 'notes.txt'), 'multi\nline\nfile\n');
  return dir;
}

describe('zip helpers', () => {
  it('round-trips a fixture template directory', async () => {
    const src = makeFixture('acme');
    const zipPath = join(root, 'acme.zip');
    await packDirectory(src, zipPath);
    const dest = mkdtempSync(join(root, 'extract-'));
    await unpackZip(zipPath, dest);
    expect(readFileSync(join(dest, 'template.json'), 'utf8')).toBe(
      readFileSync(join(src, 'template.json'), 'utf8'),
    );
    const origPng = readFileSync(join(src, 'assets', 'logo.png'));
    const roundPng = readFileSync(join(dest, 'assets', 'logo.png'));
    expect(roundPng.equals(origPng)).toBe(true);
    expect(readFileSync(join(dest, 'assets', 'notes.txt'), 'utf8')).toBe(
      readFileSync(join(src, 'assets', 'notes.txt'), 'utf8'),
    );
  });

  it('listZipEntries enumerates entries with sizes', async () => {
    const src = makeFixture('proto');
    const zipPath = join(root, 'proto.zip');
    await packDirectory(src, zipPath);
    const entries = await listZipEntries(zipPath);
    const names = entries
      .filter((e) => !e.dir)
      .map((e) => e.name)
      .sort();
    expect(names).toContain('template.json');
    expect(names).toContain('assets/logo.png');
    expect(names).toContain('assets/notes.txt');
  });

  it('readZipEntry reads one file by name without full unpack', async () => {
    const src = makeFixture('beta');
    const zipPath = join(root, 'beta.zip');
    await packDirectory(src, zipPath);
    const tj = await readZipEntry(zipPath, 'template.json');
    expect(tj).not.toBeNull();
    const parsed = JSON.parse((tj as Buffer).toString('utf8'));
    expect(parsed.name).toBe('beta');
  });

  it('refuses paths with leading "/" (zip-slip guard tested directly)', async () => {
    // jszip normalises ".." away on add, so we can't easily construct that
    // hostile archive with the same library — instead verify the guard
    // function by patching a freshly packed zip's central directory using
    // a hand-rolled entry name. Simpler: assert the guard works on a wider
    // class of bad names by exercising containsTraversal via a manual zip
    // built with a raw filename JSZip *will* preserve verbatim: anything
    // with intermediate path normalisation jszip drops, but an absolute
    // Windows-style name `C:/foo.txt` survives.
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    // jszip happily stores Windows drive-style filenames; our guard catches it.
    zip.file('C:/escape.txt', 'oh no');
    const bad = join(root, 'evil.zip');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    writeFileSync(bad, buf);
    const dest = mkdtempSync(join(root, 'evil-'));
    await expect(unpackZip(bad, dest)).rejects.toThrow(/Refusing to extract/);
  });
});
