/**
 * A tiny editable text buffer with a caret, used by the chat prompt and the
 * menu text inputs. Pure functions over `{ text, caret }` so the cursor logic
 * is unit-testable and shared between components.
 *
 * `caret` is an index into `text` in the range [0, text.length]; it points
 * *between* characters (caret === text.length means "after the last char").
 */
export type Buffer = { text: string; caret: number };

export const empty = (): Buffer => ({ text: '', caret: 0 });

/** Insert a string at the caret and advance past it. */
export function insert(b: Buffer, s: string): Buffer {
  return {
    text: b.text.slice(0, b.caret) + s + b.text.slice(b.caret),
    caret: b.caret + s.length,
  };
}

/** Delete the character before the caret (Backspace). */
export function backspace(b: Buffer): Buffer {
  if (b.caret === 0) return b;
  return {
    text: b.text.slice(0, b.caret - 1) + b.text.slice(b.caret),
    caret: b.caret - 1,
  };
}

/** Delete the character after the caret (forward Delete). */
export function del(b: Buffer): Buffer {
  if (b.caret >= b.text.length) return b;
  return {
    text: b.text.slice(0, b.caret) + b.text.slice(b.caret + 1),
    caret: b.caret,
  };
}

export const left = (b: Buffer): Buffer => ({ ...b, caret: Math.max(0, b.caret - 1) });
export const right = (b: Buffer): Buffer => ({ ...b, caret: Math.min(b.text.length, b.caret + 1) });
export const home = (b: Buffer): Buffer => ({ ...b, caret: 0 });
export const end = (b: Buffer): Buffer => ({ ...b, caret: b.text.length });

/** Map a flat caret index onto its (row, col) in a `\n`-split buffer. */
export function caretRowCol(text: string, caret: number): { row: number; col: number } {
  const lines = text.split('\n');
  let remaining = caret;
  for (let row = 0; row < lines.length; row++) {
    if (remaining <= lines[row].length) return { row, col: remaining };
    remaining -= lines[row].length + 1; // +1 for the consumed newline
  }
  // Caret past the end (shouldn't happen): clamp to last position.
  const row = lines.length - 1;
  return { row, col: lines[row].length };
}

/**
 * Move the caret one visual row up/down, preserving column where possible.
 * Returns the buffer unchanged when there is no row to move to (caller can then
 * let the key fall through, e.g. for history recall).
 */
export function moveVertical(b: Buffer, dir: -1 | 1): Buffer {
  const lines = b.text.split('\n');
  if (lines.length === 1) return b;
  const { row, col } = caretRowCol(b.text, b.caret);
  const targetRow = row + dir;
  if (targetRow < 0 || targetRow >= lines.length) return b;
  const targetCol = Math.min(col, lines[targetRow].length);
  // Rebuild the flat caret index for (targetRow, targetCol).
  let caret = 0;
  for (let i = 0; i < targetRow; i++) caret += lines[i].length + 1;
  caret += targetCol;
  return { ...b, caret };
}
