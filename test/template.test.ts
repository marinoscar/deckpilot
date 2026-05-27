import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectTemplate } from '../src/template/inspect.js';
import { type FileEntry, filterFiles } from '../src/util/files.js';

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-tmpl-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Brand">
  <a:themeElements>
    <a:clrScheme name="Brand">
      <a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="222222"/></a:dk2>
      <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
      <a:accent1><a:srgbClr val="FF6600"/></a:accent1>
      <a:accent2><a:srgbClr val="993300"/></a:accent2>
      <a:accent3><a:srgbClr val="666666"/></a:accent3>
      <a:accent4><a:srgbClr val="0066FF"/></a:accent4>
      <a:accent5><a:srgbClr val="009966"/></a:accent5>
      <a:accent6><a:srgbClr val="990099"/></a:accent6>
      <a:hlink><a:srgbClr val="0066FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="9900CC"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Brand">
      <a:majorFont>
        <a:latin typeface="Atkinson Hyperlegible"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="IBM Plex Sans"/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

const PRESENTATION_XML = `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`;

const SLIDE_LAYOUT_1 = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Title Slide"/>
</p:sldLayout>`;

const SLIDE_LAYOUT_2 = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Title and Content"/>
</p:sldLayout>`;

let templatePath: string;

beforeAll(async () => {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  zip.file('ppt/theme/theme1.xml', THEME_XML);
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT_1);
  zip.file('ppt/slideLayouts/slideLayout2.xml', SLIDE_LAYOUT_2);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  templatePath = join(dir, 'brand.pptx');
  writeFileSync(templatePath, buf);
});

describe('inspectTemplate', () => {
  it('extracts accent colour and fonts from theme1.xml', async () => {
    const profile = await inspectTemplate(templatePath);
    expect(profile.colors.accent).toBe('FF6600');
    expect(profile.colors.accentDark).toBe('993300');
    expect(profile.fonts.heading).toBe('Atkinson Hyperlegible');
    expect(profile.fonts.body).toBe('IBM Plex Sans');
  });

  it('reads the slide size and infers 16:9', async () => {
    const profile = await inspectTemplate(templatePath);
    expect(profile.aspect).toBe('16:9');
    expect(profile.slideSize.width).toBeCloseTo(13.33, 1);
    expect(profile.slideSize.height).toBeCloseTo(7.5, 1);
  });

  it('reads layout names in order', async () => {
    const profile = await inspectTemplate(templatePath);
    expect(profile.layoutNames).toEqual(['Title Slide', 'Title and Content']);
  });

  it('throws on a non-pptx zip', async () => {
    const empty = new JSZip();
    empty.file('readme.txt', 'not a deck');
    const buf = await empty.generateAsync({ type: 'nodebuffer' });
    const p = join(dir, 'not-pptx.zip');
    writeFileSync(p, buf);
    await expect(inspectTemplate(p)).rejects.toThrow(/presentation\.xml/);
  });
});

describe('filterFiles', () => {
  const sample: FileEntry[] = [
    { path: 'brand.pptx', name: 'brand.pptx', kind: 'pptx', mtime: 1, size: 0 },
    {
      path: 'archive/old-deck.plan.json',
      name: 'old-deck.plan.json',
      kind: 'plan.json',
      mtime: 1,
      size: 0,
    },
    { path: 'q3-sales.pptx', name: 'q3-sales.pptx', kind: 'pptx', mtime: 1, size: 0 },
  ];

  it('returns everything when query is empty', () => {
    expect(filterFiles(sample, '').length).toBe(3);
  });

  it('substring-matches across path and name, case-insensitive', () => {
    expect(filterFiles(sample, 'BRAND').map((f) => f.name)).toEqual(['brand.pptx']);
    expect(filterFiles(sample, 'q3').map((f) => f.name)).toEqual(['q3-sales.pptx']);
    expect(filterFiles(sample, 'archive').map((f) => f.name)).toEqual(['old-deck.plan.json']);
  });
});
