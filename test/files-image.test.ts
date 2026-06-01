import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_ATTACHED_IMAGES,
  extToMime,
  mergeImages,
  scanWorkspaceFiles,
  toggleImage,
} from '../src/util/files.js';

describe('extToMime', () => {
  it('maps supported image extensions to MIME types', () => {
    expect(extToMime('a.png')).toBe('image/png');
    expect(extToMime('a.jpg')).toBe('image/jpeg');
    expect(extToMime('a.jpeg')).toBe('image/jpeg');
    expect(extToMime('a.gif')).toBe('image/gif');
    expect(extToMime('a.webp')).toBe('image/webp');
  });

  it('is case-insensitive and path-aware', () => {
    expect(extToMime('PHOTO.PNG')).toBe('image/png');
    expect(extToMime('./assets/Hero.JPEG')).toBe('image/jpeg');
  });

  it('returns null for non-image or extensionless names', () => {
    expect(extToMime('deck.pptx')).toBeNull();
    expect(extToMime('notes.txt')).toBeNull();
    expect(extToMime('bmpfile.bmp')).toBeNull();
    expect(extToMime('README')).toBeNull();
  });
});

describe('toggleImage', () => {
  it('adds when absent, removes when present', () => {
    expect(toggleImage([], 'a.png')).toEqual(['a.png']);
    expect(toggleImage(['a.png'], 'a.png')).toEqual([]);
    expect(toggleImage(['a.png'], 'b.png')).toEqual(['a.png', 'b.png']);
  });

  it('does not add beyond the cap', () => {
    const full = Array.from({ length: MAX_ATTACHED_IMAGES }, (_, i) => `img${i}.png`);
    expect(toggleImage(full, 'extra.png')).toEqual(full);
    // ...but can still remove an existing one when full.
    expect(toggleImage(full, 'img0.png')).toHaveLength(MAX_ATTACHED_IMAGES - 1);
  });
});

describe('mergeImages', () => {
  it('adds new paths, dedupes, preserves order', () => {
    expect(mergeImages(['a.png'], ['b.png', 'a.png', 'c.png'])).toEqual([
      'a.png',
      'b.png',
      'c.png',
    ]);
  });

  it('caps the merged list at MAX_ATTACHED_IMAGES', () => {
    const incoming = Array.from({ length: MAX_ATTACHED_IMAGES + 5 }, (_, i) => `i${i}.png`);
    expect(mergeImages([], incoming)).toHaveLength(MAX_ATTACHED_IMAGES);
  });
});

describe('scanWorkspaceFiles — image vs default kinds', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deckpilot-scan-img-'));
    for (const name of ['a.png', 'b.jpg', 'c.webp', 'deck.pptx', 'data.json', 'notes.txt']) {
      writeFileSync(join(dir, name), 'x');
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("kinds:'images' surfaces only image files", async () => {
    const files = await scanWorkspaceFiles(dir, { kinds: 'images' });
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['a.png', 'b.jpg', 'c.webp']);
    expect(files.every((f) => f.kind === 'image')).toBe(true);
  });

  it('the default scan never surfaces images (the @-picker guarantee)', async () => {
    const files = await scanWorkspaceFiles(dir);
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['data.json', 'deck.pptx']);
    expect(files.some((f) => f.kind === 'image')).toBe(false);
  });
});
