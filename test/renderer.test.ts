import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { renderSampleDeck } from '../src/render/renderer.js';

const dir = mkdtempSync(join(tmpdir(), 'deckpilot-test-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('renderSampleDeck', () => {
  it('emits a non-empty .pptx file', async () => {
    const out = join(dir, 'sample.pptx');
    const abs = await renderSampleDeck(out);
    expect(abs).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(10_000);
  });

  it('contains 3 slide parts in the OOXML zip', async () => {
    const out = join(dir, 'three.pptx');
    await renderSampleDeck(out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slidePaths = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    expect(slidePaths.length).toBe(3);
  });
});
