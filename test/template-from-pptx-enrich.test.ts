import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { templateFromPptx } from '../src/template/from-pptx.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-from-pptx-enrich-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="brand">
      <a:dk1><a:srgbClr val="1F2328"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="0B0C0E"/></a:dk2>
      <a:lt2><a:srgbClr val="F4F4F4"/></a:lt2>
      <a:accent1><a:srgbClr val="0F62FE"/></a:accent1>
      <a:accent2><a:srgbClr val="C8202E"/></a:accent2>
      <a:accent3><a:srgbClr val="0AA1A1"/></a:accent3>
      <a:accent4><a:srgbClr val="F1C21B"/></a:accent4>
      <a:accent5><a:srgbClr val="B8398A"/></a:accent5>
      <a:accent6><a:srgbClr val="2E8B47"/></a:accent6>
      <a:hlink><a:srgbClr val="0066CC"/></a:hlink>
      <a:folHlink><a:srgbClr val="551A8B"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="brand">
      <a:majorFont><a:latin typeface="Inter Tight"/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

async function buildPptxOnDisk(): Promise<string> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation ${NS}><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file('ppt/theme/theme1.xml', THEME);
  // Title slide with a full-bleed background image.
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId1"/></a:blipFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cover.png"/></Relationships>`,
  );
  zip.file('ppt/media/cover.png', PNG_BYTES);

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const path = join(root, 'enrich.pptx');
  writeFileSync(path, buf);
  return path;
}

describe('templateFromPptx — cover background + full theme palette', () => {
  it('populates assets.background and the named themePalette', async () => {
    const pptx = await buildPptxOnDisk();
    const tplRoot = mkdtempSync(join(root, 'tpl-'));

    const spec = await templateFromPptx('brandx', pptx, { templateRootDir: tplRoot });

    // Part A: the title slide's background became assets.background.
    expect(spec.assets?.background).toBe('assets/cover-background.png');

    // Part C: the full clrScheme is preserved, including accent4-6 the
    // renderable theme drops, with hyperlink tokens renamed.
    expect(spec.themePalette).toBeDefined();
    expect(spec.themePalette?.accent1).toBe('0F62FE');
    expect(spec.themePalette?.accent4).toBe('F1C21B');
    expect(spec.themePalette?.accent5).toBe('B8398A');
    expect(spec.themePalette?.accent6).toBe('2E8B47');
    expect(spec.themePalette?.dk1).toBe('1F2328');
    expect(spec.themePalette?.hyperlink).toBe('0066CC');
    expect(spec.themePalette?.followedHyperlink).toBe('551A8B');
  });

  it('honours --no-cover-background / --no-palette-samples opt-outs', async () => {
    const pptx = await buildPptxOnDisk();
    const tplRoot = mkdtempSync(join(root, 'tpl-optout-'));

    const spec = await templateFromPptx('brandx', pptx, {
      templateRootDir: tplRoot,
      extractCoverBackground: false,
      extractPalette: false,
    });

    expect(spec.assets?.background).toBeUndefined();
    expect(spec.themePalette).toBeUndefined();
  });
});

/** Write an arbitrary set of zip parts to a .pptx on disk; returns its path. */
async function writePptx(name: string, parts: Record<string, string | Buffer>): Promise<string> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation ${NS}><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file('ppt/theme/theme1.xml', THEME);
  for (const [path, body] of Object.entries(parts)) zip.file(path, body);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const path = join(root, name);
  writeFileSync(path, buf);
  return path;
}

const imgBg = (rid: string) =>
  `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="${rid}"/></a:blipFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>`;
const emptySld = `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree/></p:cSld></p:sld>`;
const imgRels = (target: string, layout?: string) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>${
    layout
      ? `<Relationship Id="rIdL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${layout}"/>`
      : ''
  }</Relationships>`;
const sldLayout = (type?: string) =>
  `<?xml version="1.0"?><p:sldLayout ${NS}${type ? ` type="${type}"` : ''}><p:cSld><p:spTree/></p:cSld></p:sldLayout>`;

describe('templateFromPptx — cover vs content backgrounds', () => {
  it('captures distinct cover + content backgrounds', async () => {
    const pptx = await writePptx('distinct.pptx', {
      'ppt/slides/slide1.xml': imgBg('rId1'),
      'ppt/slides/_rels/slide1.xml.rels': imgRels(
        '../media/cover.png',
        '../slideLayouts/slideLayout1.xml',
      ),
      'ppt/slides/slide2.xml': imgBg('rId1'),
      'ppt/slides/_rels/slide2.xml.rels': imgRels(
        '../media/content.png',
        '../slideLayouts/slideLayout2.xml',
      ),
      'ppt/slideLayouts/slideLayout1.xml': sldLayout('title'),
      'ppt/slideLayouts/slideLayout2.xml': sldLayout(),
      'ppt/media/cover.png': PNG_BYTES,
      'ppt/media/content.png': PNG_BYTES,
    });
    const tplRoot = mkdtempSync(join(root, 'tpl-distinct-'));

    const spec = await templateFromPptx('brandx', pptx, { templateRootDir: tplRoot });

    expect(spec.assets?.background).toBe('assets/cover-background.png');
    expect(spec.master?.coverBackground).toEqual({
      type: 'image',
      src: 'assets/cover-background.png',
    });
    expect(spec.master?.background).toEqual({
      type: 'image',
      src: 'assets/content-background.png',
    });
    expect(existsSync(join(tplRoot, 'assets', 'cover-background.png'))).toBe(true);
    expect(existsSync(join(tplRoot, 'assets', 'content-background.png'))).toBe(true);
  });

  it('a single shared background does not duplicate the asset or set coverBackground', async () => {
    const pptx = await writePptx('shared.pptx', {
      // Both slides inherit the master background; no distinct cover image.
      'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0"?><p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId1"/></a:blipFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldMaster>`,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': imgRels('../media/master.png'),
      'ppt/slides/slide1.xml': emptySld,
      'ppt/slides/slide2.xml': emptySld,
      'ppt/media/master.png': PNG_BYTES,
    });
    const tplRoot = mkdtempSync(join(root, 'tpl-shared-'));

    const spec = await templateFromPptx('brandx', pptx, { templateRootDir: tplRoot });

    expect(spec.master?.background).toEqual({ type: 'image', src: 'assets/master-background.png' });
    expect(spec.master?.coverBackground).toBeUndefined();
    expect(spec.assets?.background).toBeUndefined();
    // The content extractor reused the master asset — no duplicate file.
    expect(existsSync(join(tplRoot, 'assets', 'content-background.png'))).toBe(false);
  });
});
