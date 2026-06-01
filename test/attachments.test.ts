import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_PROMPT,
  DEFAULT_IMAGE_PROMPT,
  buildImageAttachments,
  effectivePrompt,
} from '../src/chat/attachments.js';
import { MAX_ATTACHED_IMAGES, MAX_IMAGE_BYTES } from '../src/util/files.js';

let dir: string;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'deckpilot-attach-'));
  writeFileSync(join(dir, 'cover.png'), PNG_BYTES);
  writeFileSync(join(dir, 'chart.jpg'), JPG_BYTES);
  writeFileSync(join(dir, 'notes.txt'), 'not an image');
  writeFileSync(join(dir, 'big.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('buildImageAttachments', () => {
  it('builds base64 blob attachments for supported images, in order', async () => {
    const { attachments, attachedPaths, skipped } = await buildImageAttachments([
      join(dir, 'cover.png'),
      join(dir, 'chart.jpg'),
    ]);
    expect(skipped).toEqual([]);
    expect(attachedPaths).toEqual([join(dir, 'cover.png'), join(dir, 'chart.jpg')]);
    expect(attachments).toEqual([
      {
        type: 'blob',
        mimeType: 'image/png',
        data: PNG_BYTES.toString('base64'),
        displayName: 'cover.png',
      },
      {
        type: 'blob',
        mimeType: 'image/jpeg',
        data: JPG_BYTES.toString('base64'),
        displayName: 'chart.jpg',
      },
    ]);
  });

  it('skips unsupported formats with a reason', async () => {
    const { attachments, skipped } = await buildImageAttachments([join(dir, 'notes.txt')]);
    expect(attachments).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/unsupported/i);
  });

  it('skips unreadable files', async () => {
    const { attachments, skipped } = await buildImageAttachments([join(dir, 'does-not-exist.png')]);
    expect(attachments).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/could not read/i);
  });

  it('skips images over the size limit', async () => {
    const { attachments, skipped } = await buildImageAttachments([join(dir, 'big.png')]);
    expect(attachments).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/exceeds/i);
  });

  it('caps the number of attachments at MAX_ATTACHED_IMAGES', async () => {
    const many = Array.from({ length: MAX_ATTACHED_IMAGES + 3 }, () => join(dir, 'cover.png'));
    const { attachments } = await buildImageAttachments(many);
    expect(attachments).toHaveLength(MAX_ATTACHED_IMAGES);
  });
});

describe('effectivePrompt', () => {
  it('returns the user text when present', () => {
    expect(effectivePrompt('match this style', { hasDocs: true })).toBe('match this style');
  });

  it('uses the document default when only documents are attached', () => {
    expect(effectivePrompt('', { hasDocs: true })).toBe(DEFAULT_DOCUMENT_PROMPT);
    expect(effectivePrompt('   ', { hasDocs: true, hasImages: true })).toBe(
      DEFAULT_DOCUMENT_PROMPT,
    );
  });

  it('uses the image default when only images are attached or nothing is', () => {
    expect(effectivePrompt('', { hasImages: true })).toBe(DEFAULT_IMAGE_PROMPT);
    expect(effectivePrompt('')).toBe(DEFAULT_IMAGE_PROMPT);
  });
});
