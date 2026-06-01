import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { MAX_ATTACHED_IMAGES, MAX_IMAGE_BYTES, extToMime, humanSize } from '../util/files.js';

export type ImageAttachment = {
  type: 'blob';
  data: string;
  mimeType: string;
  displayName: string;
};

export type BuiltAttachments = {
  /** Blob attachments ready to pass to `session.send({ attachments })`. */
  attachments: ImageAttachment[];
  /** Source paths that became attachments (for project persistence). */
  attachedPaths: string[];
  /** Paths skipped, with a human-readable reason (surfaced as system messages). */
  skipped: { path: string; reason: string }[];
};

/**
 * Read staged reference images and build base64 `blob` attachments for a
 * multimodal turn. Skips unsupported formats, unreadable files, and images
 * over `MAX_IMAGE_BYTES`; caps the count at `MAX_ATTACHED_IMAGES`. Pure (no
 * session state) so the attachment logic is unit-testable without the SDK.
 */
export async function buildImageAttachments(imagePaths: string[]): Promise<BuiltAttachments> {
  const attachments: ImageAttachment[] = [];
  const attachedPaths: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const p of imagePaths.slice(0, MAX_ATTACHED_IMAGES)) {
    const mimeType = extToMime(p);
    if (!mimeType) {
      skipped.push({ path: p, reason: 'unsupported image format' });
      continue;
    }
    let buf: Buffer;
    try {
      buf = await readFile(p);
    } catch (e) {
      skipped.push({ path: p, reason: `could not read file: ${(e as Error).message}` });
      continue;
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      skipped.push({
        path: p,
        reason: `${humanSize(buf.byteLength)} exceeds the ${humanSize(MAX_IMAGE_BYTES)} limit`,
      });
      continue;
    }
    attachments.push({
      type: 'blob',
      data: buf.toString('base64'),
      mimeType,
      displayName: basename(p),
    });
    attachedPaths.push(p);
  }

  return { attachments, attachedPaths, skipped };
}

/** The prompt actually sent: the user's text, or a default when only images. */
export const DEFAULT_IMAGE_PROMPT = 'Use the attached reference image(s) to inform the deck.';
export function effectivePrompt(text: string): string {
  return text.trim().length > 0 ? text : DEFAULT_IMAGE_PROMPT;
}
