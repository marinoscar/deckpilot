import { describe, expect, it } from 'vitest';
import {
  type Buffer,
  backspace,
  caretRowCol,
  del,
  empty,
  end,
  home,
  insert,
  left,
  moveVertical,
  right,
} from '../src/ui/text-buffer.js';

const b = (text: string, caret: number): Buffer => ({ text, caret });

describe('insert', () => {
  it('inserts at the caret and advances past it', () => {
    expect(insert(b('ac', 1), 'b')).toEqual(b('abc', 2));
  });
  it('inserts multi-char strings (paste) as one unit', () => {
    expect(insert(b('', 0), 'hi\nthere')).toEqual(b('hi\nthere', 8));
  });
  it('appends at end', () => {
    expect(insert(empty(), 'x')).toEqual(b('x', 1));
  });
});

describe('backspace vs delete', () => {
  it('backspace removes the char before the caret', () => {
    expect(backspace(b('abc', 2))).toEqual(b('ac', 1));
  });
  it('backspace at start is a no-op', () => {
    expect(backspace(b('abc', 0))).toEqual(b('abc', 0));
  });
  it('delete removes the char after the caret, caret stays', () => {
    expect(del(b('abc', 1))).toEqual(b('ac', 1));
  });
  it('delete at end is a no-op', () => {
    expect(del(b('abc', 3))).toEqual(b('abc', 3));
  });
});

describe('caret movement clamps at the edges', () => {
  it('left/right move one char', () => {
    expect(left(b('abc', 2))).toEqual(b('abc', 1));
    expect(right(b('abc', 1))).toEqual(b('abc', 2));
  });
  it('left at 0 and right at end are no-ops', () => {
    expect(left(b('abc', 0))).toEqual(b('abc', 0));
    expect(right(b('abc', 3))).toEqual(b('abc', 3));
  });
  it('home/end jump to the extremes', () => {
    expect(home(b('abc', 2))).toEqual(b('abc', 0));
    expect(end(b('abc', 0))).toEqual(b('abc', 3));
  });
});

describe('caretRowCol', () => {
  it('maps a flat index to (row, col) across newlines', () => {
    // "ab\ncd" → indices: a0 b1 \n2 c3 d4
    expect(caretRowCol('ab\ncd', 0)).toEqual({ row: 0, col: 0 });
    expect(caretRowCol('ab\ncd', 2)).toEqual({ row: 0, col: 2 }); // end of line 0
    expect(caretRowCol('ab\ncd', 3)).toEqual({ row: 1, col: 0 }); // start of line 1
    expect(caretRowCol('ab\ncd', 5)).toEqual({ row: 1, col: 2 });
  });
});

describe('moveVertical', () => {
  it('is a no-op on a single-line buffer', () => {
    expect(moveVertical(b('abc', 1), -1)).toEqual(b('abc', 1));
    expect(moveVertical(b('abc', 1), 1)).toEqual(b('abc', 1));
  });
  it('moves down preserving column', () => {
    // "abc\ndef", caret at col 2 of row 0 (index 2) → row 1 col 2 (index 6)
    expect(moveVertical(b('abc\ndef', 2), 1)).toEqual(b('abc\ndef', 6));
  });
  it('moves up preserving column', () => {
    expect(moveVertical(b('abc\ndef', 6), -1)).toEqual(b('abc\ndef', 2));
  });
  it('clamps column to the shorter target line', () => {
    // "abcd\nx", caret at col 4 of row 0 (index 4) → row 1 has length 1 → col 1 (index 6)
    expect(moveVertical(b('abcd\nx', 4), 1)).toEqual(b('abcd\nx', 6));
  });
  it('is a no-op past the first/last row', () => {
    expect(moveVertical(b('a\nb', 0), -1)).toEqual(b('a\nb', 0));
    expect(moveVertical(b('a\nb', 2), 1)).toEqual(b('a\nb', 2));
  });
});
