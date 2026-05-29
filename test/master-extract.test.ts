import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { extractMasterFromPptx } from '../src/template/master-extract.js';

const FIXTURE = join(process.cwd(), 'test/fixtures/sample-branded.pptx');

const root = mkdtempSync(join(tmpdir(), 'deckpilot-master-extract-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function openFixture(): Promise<JSZip> {
  const buf = readFileSync(FIXTURE);
  return JSZip.loadAsync(buf);
}

describe('extractMasterFromPptx — sample-branded.pptx fixture', () => {
  it('returns a master with a solid navy background and three objects', async () => {
    const zip = await openFixture();
    const templateRoot = mkdtempSync(join(root, 'tpl-'));

    const result = await extractMasterFromPptx(zip, templateRoot);

    expect(result.master).toBeDefined();
    expect(result.master?.background).toEqual({ type: 'solid', color: '1A2B5E' });
    expect(result.master?.objects).toBeDefined();

    // Expect at least: 1 image (logo), 1 rect (rail), 1 text (footer).
    const kinds = result.master?.objects?.map((o) => o.kind) ?? [];
    expect(kinds).toContain('image');
    expect(kinds).toContain('rect');
    expect(kinds).toContain('text');
  });

  it('copies the master logo into <templateRoot>/assets/', async () => {
    const zip = await openFixture();
    const templateRoot = mkdtempSync(join(root, 'tpl-assets-'));

    const result = await extractMasterFromPptx(zip, templateRoot);

    const imageObjects = result.master?.objects?.filter((o) => o.kind === 'image') ?? [];
    expect(imageObjects.length).toBeGreaterThan(0);

    // Every image src points to an actual file we wrote.
    for (const obj of imageObjects) {
      if (obj.kind !== 'image') continue;
      const abs = join(templateRoot, ...obj.src.split('/'));
      expect(existsSync(abs)).toBe(true);
      const bytes = await readFile(abs);
      expect(bytes.length).toBeGreaterThan(0);
    }
    expect(result.copiedAssets.length).toBeGreaterThan(0);
    expect(result.copiedAssets[0].startsWith('assets/')).toBe(true);
  });

  it('extracts the black right-rail rect with the correct fill', async () => {
    const zip = await openFixture();
    const templateRoot = mkdtempSync(join(root, 'tpl-rail-'));

    const result = await extractMasterFromPptx(zip, templateRoot);

    const rect = result.master?.objects?.find((o) => o.kind === 'rect' && o.fill === '000000');
    expect(rect).toBeDefined();
    if (rect && rect.kind === 'rect') {
      // The fixture set the rail at x=12.4, y=0, w=0.93, h=7.5 (close to these
      // values after EMU rounding).
      expect(rect.x).toBeGreaterThan(12);
      expect(rect.y).toBeLessThan(0.1);
      expect(rect.w).toBeGreaterThan(0.8);
      expect(rect.w).toBeLessThan(1.1);
      expect(rect.h).toBeGreaterThan(7);
    }
  });

  it('extracts the footer text with its content + colour', async () => {
    const zip = await openFixture();
    const templateRoot = mkdtempSync(join(root, 'tpl-text-'));

    const result = await extractMasterFromPptx(zip, templateRoot);

    const text = result.master?.objects?.find((o) => o.kind === 'text');
    expect(text).toBeDefined();
    if (text && text.kind === 'text') {
      expect(text.text).toContain('BRAND v0.16 fixture');
      expect(text.color).toBe('FFFFFF');
      expect(text.fontFace).toBe('Helvetica');
      expect(text.fontSize).toBe(9);
    }
  });

  it('skips image objects when no templateRoot is provided', async () => {
    const zip = await openFixture();
    const result = await extractMasterFromPptx(zip, undefined);

    // Background (solid) and rect/text shapes still come through.
    expect(result.master?.background).toEqual({ type: 'solid', color: '1A2B5E' });
    expect(result.master?.objects?.find((o) => o.kind === 'rect')).toBeDefined();
    expect(result.master?.objects?.find((o) => o.kind === 'text')).toBeDefined();
    // Images are skipped because we have nowhere to write the bytes.
    expect(result.master?.objects?.find((o) => o.kind === 'image')).toBeUndefined();
    expect(result.copiedAssets.length).toBe(0);
  });

  it('returns undefined master when nothing chrome-like exists', async () => {
    // Empty .pptx-shaped zip with master that has no bg + no shapes.
    const zip = new JSZip();
    zip.file(
      'ppt/slideMasters/slideMaster1.xml',
      `<?xml version="1.0"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree/></p:cSld>
</p:sldMaster>`,
    );
    zip.file(
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    );

    const result = await extractMasterFromPptx(zip, undefined);
    expect(result.master).toBeUndefined();
    expect(result.copiedAssets).toEqual([]);
  });
});
