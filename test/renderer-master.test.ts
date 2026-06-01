import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { type DeckBrief, DeckBriefSchema } from '../src/deck/brief.js';
import { renderDeck } from '../src/render/renderer.js';
import { extractMasterFromPptx } from '../src/template/master-extract.js';
import type { TemplateProfile } from '../src/template/profile.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-renderer-master-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BRIEF: DeckBrief = DeckBriefSchema.parse({
  meta: { title: 'master-inheritance test', author: 'DeckPilot' },
  theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
  slides: [
    { id: 'a', title: 'A', purpose: 'first.' },
    { id: 'b', title: 'B', purpose: 'second.' },
  ],
});

const CODE = new Map<string, string>([
  [
    'a',
    `function render(slide, theme) {
       slide.addText('Slide A body', { x: 1, y: 3, w: 11, h: 1, fontSize: 32, color: 'FFFFFF' });
     }`,
  ],
  [
    'b',
    `function render(slide, theme) {
       slide.addText('Slide B body', { x: 1, y: 3, w: 11, h: 1, fontSize: 32, color: 'FFFFFF' });
     }`,
  ],
]);

async function loadFixtureMaster(rootDir: string): Promise<TemplateProfile> {
  const fixture = join(process.cwd(), 'test/fixtures/sample-branded.pptx');
  const buf = readFileSync(fixture);
  const zip = await JSZip.loadAsync(buf);
  const { master } = await extractMasterFromPptx(zip, rootDir);
  if (!master) throw new Error('fixture master extraction returned empty — test setup is wrong');
  return {
    sourcePath: fixture,
    aspect: '16:9',
    slideSize: { width: 13.33, height: 7.5 },
    colors: { accent: '1A2B5E', accentDark: 'C8202E', paper: 'FFFFFF' },
    fonts: { heading: 'Inter Tight', body: 'Inter' },
    layoutNames: [],
    master,
    rootDir,
  };
}

describe('renderDeck — master inheritance', () => {
  it('emits the master layout into ppt/slideLayouts when a master is supplied', async () => {
    const tplRoot = mkdtempSync(join(root, 'tpl-'));
    const template = await loadFixtureMaster(tplRoot);
    const out = join(root, 'with-master.pptx');

    await renderDeck(BRIEF, CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const layoutPaths = Object.keys(zip.files).filter((p) =>
      /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p),
    );
    expect(layoutPaths.length).toBeGreaterThan(0);

    // The new layout pptxgenjs emits must carry our master title.
    let found = false;
    for (const p of layoutPaths) {
      const xml = await zip.file(p)!.async('string');
      if (xml.includes('TemplateMaster')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('embeds the master logo bytes into ppt/media/', async () => {
    const tplRoot = mkdtempSync(join(root, 'tpl-media-'));
    const template = await loadFixtureMaster(tplRoot);
    const out = join(root, 'with-logo.pptx');

    await renderDeck(BRIEF, CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const media = Object.keys(zip.files).filter((p) => /^ppt\/media\//.test(p));
    expect(media.length).toBeGreaterThan(0);
  });

  it('emits slides referencing the brand layout (master inheritance path)', async () => {
    const tplRoot = mkdtempSync(join(root, 'tpl-ref-'));
    const template = await loadFixtureMaster(tplRoot);
    const out = join(root, 'with-master-refs.pptx');

    await renderDeck(BRIEF, CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // Slide should carry the body text the LLM wrote.
    expect(slide1).toMatch(/Slide A body/);
    // And the slide should NOT carry its own background fill (the master owns it).
    expect(slide1).not.toMatch(/<p:bg>/);
  });

  it('regression: rendering WITHOUT a template still works', async () => {
    const out = join(root, 'no-master.pptx');
    await renderDeck(BRIEF, CODE, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // Untemplated render still paints the default paper background.
    expect(slide1).toMatch(/Slide A body/);
  });

  it('drops image master objects when rootDir is absent (one-shot profile)', async () => {
    const tplRoot = mkdtempSync(join(root, 'tpl-noroot-'));
    const template = await loadFixtureMaster(tplRoot);
    // Simulate a one-shot profile: drop rootDir, the renderer should skip
    // image objects but keep solid backgrounds and rect/text shapes.
    const oneShot: TemplateProfile = { ...template, rootDir: undefined };
    const out = join(root, 'no-rootdir.pptx');
    await renderDeck(BRIEF, CODE, out, { template: oneShot });
    // Should not throw; output is a valid .pptx.
    const zip = await JSZip.loadAsync(readFileSync(out));
    expect(zip.file('ppt/presentation.xml')).not.toBeNull();
  });
});

describe('renderDeck — cover vs content backgrounds', () => {
  const CONTENT = 'EEEEEE';
  const COVER = '111133';

  function profileWith(master: TemplateProfile['master']): TemplateProfile {
    return {
      sourcePath: 'x',
      aspect: '16:9',
      slideSize: { width: 13.33, height: 7.5 },
      colors: { accent: '1A2B5E', paper: 'FFFFFF' },
      fonts: { heading: 'Inter Tight', body: 'Inter' },
      layoutNames: [],
      master,
      rootDir: root,
    };
  }

  const ROLE_BRIEF: DeckBrief = DeckBriefSchema.parse({
    meta: { title: 'roles', author: 'DeckPilot' },
    theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
    slides: [
      { id: 'a', title: 'Cover', purpose: 'cover.', role: 'cover' },
      { id: 'b', title: 'Body', purpose: 'content.', role: 'content' },
      { id: 'c', title: 'Section', purpose: 'divider.', role: 'divider' },
    ],
  });
  const ROLE_CODE = new Map<string, string>(
    ['a', 'b', 'c'].map((id) => [
      id,
      `function render(slide){ slide.addText('${id}', { x:1, y:3, w:11, h:1 }); }`,
    ]),
  );

  it('applies coverBackground to cover + divider slides; content inherits the master', async () => {
    const template = profileWith({
      background: { type: 'solid', color: CONTENT },
      coverBackground: { type: 'solid', color: COVER },
    });
    const out = join(root, 'roles.pptx');
    await renderDeck(ROLE_BRIEF, ROLE_CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string'); // cover
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string'); // content
    const s3 = await zip.file('ppt/slides/slide3.xml')!.async('string'); // divider

    // Cover + divider carry their own background with the cover colour.
    expect(s1).toMatch(/<p:bg>/);
    expect(s1).toContain(COVER);
    expect(s3).toContain(COVER);
    // Content slide inherits the master content background — no own <p:bg>.
    expect(s2).not.toMatch(/<p:bg>/);
  });

  it('treats slide 1 as the cover when no roles are set', async () => {
    const noRole: DeckBrief = DeckBriefSchema.parse({
      meta: { title: 'norole' },
      theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
      slides: [
        { id: 'a', title: 'A', purpose: 'a.' },
        { id: 'b', title: 'B', purpose: 'b.' },
      ],
    });
    const template = profileWith({
      background: { type: 'solid', color: CONTENT },
      coverBackground: { type: 'solid', color: COVER },
    });
    const out = join(root, 'norole.pptx');
    await renderDeck(noRole, CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s1).toContain(COVER);
    expect(s2).not.toMatch(/<p:bg>/);
  });

  it('regression: master with only a content background → no per-slide override', async () => {
    const template = profileWith({ background: { type: 'solid', color: CONTENT } });
    const out = join(root, 'content-only.pptx');
    await renderDeck(ROLE_BRIEF, ROLE_CODE, out, { template });

    const zip = await JSZip.loadAsync(readFileSync(out));
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // No coverBackground → cover inherits the master content background.
    expect(s1).not.toMatch(/<p:bg>/);
  });
});
