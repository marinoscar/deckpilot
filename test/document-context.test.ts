import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_DOC_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  buildContextBlock,
  extractDocumentText,
} from '../src/chat/document-context.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'deckpilot-doc-ctx-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

async function writeDocx(name: string, body: string): Promise<string> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document ${NS_W}><w:body>${body}</w:body></w:document>`,
  );
  const path = join(dir, name);
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

async function writePptx(name: string, opts: { notes?: boolean } = {}): Promise<string> {
  const zip = new JSZip();
  const sld = (text: string) =>
    `<?xml version="1.0"?><p:sld ${NS_A} ${NS_P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', sld('First slide body'));
  zip.file('ppt/slides/slide2.xml', sld('Second slide body'));
  if (opts.notes) {
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      `<?xml version="1.0"?><p:notes ${NS_A} ${NS_P} ${NS_R}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker note here</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
    );
  }
  const path = join(dir, name);
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

describe('extractDocumentText', () => {
  it('reads .txt and .md as raw text', async () => {
    const txt = join(dir, 'a.txt');
    const md = join(dir, 'b.md');
    writeFileSync(txt, 'plain text content');
    writeFileSync(md, '# Heading\n\nbody');
    expect(await extractDocumentText(txt)).toBe('plain text content');
    expect(await extractDocumentText(md)).toContain('# Heading');
  });

  it('extracts paragraphs and tables from a .docx', async () => {
    const path = await writeDocx(
      'doc.docx',
      '<w:p><w:r><w:t>Paragraph one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">Para </w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    const text = await extractDocumentText(path);
    expect(text).toContain('Paragraph one');
    expect(text).toContain('Para two'); // handles xml:space object form + multi-run
    expect(text).toContain('A1\tB1'); // table cells tab-joined
    expect(text.split('\n').length).toBeGreaterThanOrEqual(3); // paragraph boundaries
  });

  it('extracts all slide text from a .pptx, in order, with slide markers', async () => {
    const path = await writePptx('deck.pptx');
    const text = await extractDocumentText(path);
    expect(text).toContain('--- Slide 1 ---');
    expect(text).toContain('First slide body');
    expect(text).toContain('--- Slide 2 ---');
    expect(text.indexOf('First slide body')).toBeLessThan(text.indexOf('Second slide body'));
  });

  it('includes speaker notes by default and omits them when disabled', async () => {
    const path = await writePptx('deck-notes.pptx', { notes: true });
    expect(await extractDocumentText(path)).toContain('Speaker note here');
    expect(await extractDocumentText(path, { includeNotes: false })).not.toContain(
      'Speaker note here',
    );
  });

  it('throws on an unsupported extension', async () => {
    const path = join(dir, 'x.pdf');
    writeFileSync(path, 'pdf bytes');
    await expect(extractDocumentText(path)).rejects.toThrow(/unsupported/i);
  });
});

describe('buildContextBlock', () => {
  it('assembles a multi-doc block with delimiters and the reference-only note', async () => {
    const a = join(dir, 'sow.txt');
    const b = join(dir, 'ref.md');
    writeFileSync(a, 'statement of work');
    writeFileSync(b, 'reference notes');
    const r = await buildContextBlock([a, b]);
    expect(r.skipped).toEqual([]);
    expect(r.attached.map((x) => x.path)).toEqual([a, b]);
    expect(r.block).toContain('REFERENCE CONTEXT ONLY');
    expect(r.block).toContain('--- DOCUMENT 1: sow.txt ---');
    expect(r.block).toContain('--- DOCUMENT 2: ref.md ---');
    expect(r.block).toContain('statement of work');
    expect(r.block).toContain('=== END REFERENCE DOCUMENTS ===');
  });

  it('truncates a document over the per-doc cap', async () => {
    const big = join(dir, 'big.txt');
    writeFileSync(big, 'x'.repeat(MAX_DOC_CHARS + 5000));
    const r = await buildContextBlock([big]);
    expect(r.truncated).toBe(true);
    expect(r.block).toContain('[truncated]');
    expect(r.attached[0]!.chars).toBeLessThanOrEqual(MAX_DOC_CHARS + 20);
  });

  it('drops later docs once the total budget is exhausted', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = join(dir, `budget-${i}.txt`);
      writeFileSync(p, 'y'.repeat(MAX_DOC_CHARS));
      paths.push(p);
    }
    // 4 × 60k = 240k > 150k total → some land in skipped.
    const r = await buildContextBlock(paths);
    expect(r.truncated).toBe(true);
    expect(r.skipped.some((s) => /budget/i.test(s.reason))).toBe(true);
    const totalChars = r.attached.reduce((n, a) => n + a.chars, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS + 50);
  });

  it('skips unsupported and empty documents with reasons', async () => {
    const pdf = join(dir, 'bad.pdf');
    const empty = join(dir, 'empty.txt');
    writeFileSync(pdf, 'pdf');
    writeFileSync(empty, '   ');
    const r = await buildContextBlock([pdf, empty]);
    expect(r.block).toBe('');
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.find((s) => s.path === empty)!.reason).toMatch(/no extractable text/i);
  });
});
