import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { extractCoverBackground } from '../src/template/master-extract.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-cover-bg-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// 1×1 PNG, base64-decoded to bytes — a deterministic stand-in for media.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const bgBlip = (rId: string) =>
  `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="${rId}"/></a:blipFill></p:bgPr></p:bg>`;

const slideXml = (bg: string) =>
  `<?xml version="1.0"?><p:sld ${NS}><p:cSld>${bg}<p:spTree/></p:cSld></p:sld>`;

const layoutXml = (type: string, bg: string) =>
  `<?xml version="1.0"?><p:sldLayout ${NS} type="${type}"><p:cSld>${bg}<p:spTree/></p:cSld></p:sldLayout>`;

const rels = (entries: Array<{ id: string; type: string; target: string }>) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map((e) => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`)
    .join('')}</Relationships>`;

const IMG_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const LAYOUT_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';

describe('extractCoverBackground', () => {
  it('extracts a slide-level title background image into assets/cover-background.*', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml(bgBlip('rId1')));
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels([{ id: 'rId1', type: IMG_TYPE, target: '../media/image1.png' }]),
    );
    zip.file('ppt/media/image1.png', PNG_BYTES);

    const templateRoot = mkdtempSync(join(root, 'tpl-slide-'));
    const result = await extractCoverBackground(zip, templateRoot);

    expect(result.src).toBe('assets/cover-background.png');
    expect(result.copiedAssets).toEqual(['assets/cover-background.png']);
    const abs = join(templateRoot, 'assets', 'cover-background.png');
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).length).toBe(PNG_BYTES.length);
  });

  it("falls back to the slide's referenced layout background", async () => {
    const zip = new JSZip();
    // Slide has no bg of its own, but references a layout that does.
    zip.file('ppt/slides/slide1.xml', slideXml(''));
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels([{ id: 'rId1', type: LAYOUT_TYPE, target: '../slideLayouts/slideLayout1.xml' }]),
    );
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml('title', bgBlip('rId5')));
    zip.file(
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      rels([{ id: 'rId5', type: IMG_TYPE, target: '../media/hero.jpg' }]),
    );
    zip.file('ppt/media/hero.jpg', PNG_BYTES);

    const templateRoot = mkdtempSync(join(root, 'tpl-layout-'));
    const result = await extractCoverBackground(zip, templateRoot);

    expect(result.src).toBe('assets/cover-background.jpg');
    expect(existsSync(join(templateRoot, 'assets', 'cover-background.jpg'))).toBe(true);
  });

  it('finds a title/sectionHeader layout background when the slide does not point at one', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml(''));
    zip.file('ppt/slides/_rels/slide1.xml.rels', rels([]));
    // A non-title layout with a bg should be skipped; the title one wins.
    zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml('blank', bgBlip('rId9')));
    zip.file(
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      rels([{ id: 'rId9', type: IMG_TYPE, target: '../media/wrong.png' }]),
    );
    zip.file('ppt/slideLayouts/slideLayout2.xml', layoutXml('title', bgBlip('rId9')));
    zip.file(
      'ppt/slideLayouts/_rels/slideLayout2.xml.rels',
      rels([{ id: 'rId9', type: IMG_TYPE, target: '../media/right.png' }]),
    );
    zip.file('ppt/media/wrong.png', Buffer.from([1, 2, 3]));
    zip.file('ppt/media/right.png', PNG_BYTES);

    const templateRoot = mkdtempSync(join(root, 'tpl-title-'));
    const result = await extractCoverBackground(zip, templateRoot);

    expect(result.src).toBe('assets/cover-background.png');
    expect(readFileSync(join(templateRoot, 'assets', 'cover-background.png')).length).toBe(
      PNG_BYTES.length,
    );
  });

  it('dedups against the all-slides master background (returns nothing)', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml(bgBlip('rId1')));
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels([{ id: 'rId1', type: IMG_TYPE, target: '../media/image1.png' }]),
    );
    zip.file('ppt/media/image1.png', PNG_BYTES);

    const templateRoot = mkdtempSync(join(root, 'tpl-dedup-'));
    // The master already owns this exact media as its all-slides background.
    const result = await extractCoverBackground(zip, templateRoot, 'ppt/media/image1.png');

    expect(result.src).toBeUndefined();
    expect(result.copiedAssets).toEqual([]);
  });

  it('returns nothing when there is no image background', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml(''));
    zip.file('ppt/slides/_rels/slide1.xml.rels', rels([]));

    const templateRoot = mkdtempSync(join(root, 'tpl-none-'));
    const result = await extractCoverBackground(zip, templateRoot);

    expect(result.src).toBeUndefined();
    expect(result.copiedAssets).toEqual([]);
  });

  it('skips extraction when no templateRootDir is provided (nowhere to write)', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml(bgBlip('rId1')));
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels([{ id: 'rId1', type: IMG_TYPE, target: '../media/image1.png' }]),
    );
    zip.file('ppt/media/image1.png', PNG_BYTES);

    const result = await extractCoverBackground(zip, undefined);
    expect(result.src).toBeUndefined();
    expect(result.copiedAssets).toEqual([]);
  });
});
