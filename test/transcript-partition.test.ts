import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '../src/chat/session-types.js';
import { isFinalized, partition } from '../src/ui/transcript-partition.js';

const user = (id: string): TranscriptEntry => ({ kind: 'user', id, text: 'hi' });
const sys = (id: string): TranscriptEntry => ({ kind: 'system', id, text: 'ok' });
const asst = (id: string, streaming: boolean): TranscriptEntry => ({
  kind: 'assistant',
  id,
  text: 't',
  streaming,
});
const tool = (id: string, status: 'start' | 'done' | 'error'): TranscriptEntry => ({
  kind: 'tool',
  id,
  tool: 'x',
  status,
});

describe('isFinalized', () => {
  it('treats user/system/preview as born-final', () => {
    expect(isFinalized(user('u'))).toBe(true);
    expect(isFinalized(sys('s'))).toBe(true);
    expect(isFinalized({ kind: 'preview', id: 'p', slideId: '1', pngPath: '/x', pass: 1 })).toBe(
      true,
    );
  });
  it('finalizes assistant only when not streaming', () => {
    expect(isFinalized(asst('a', true))).toBe(false);
    expect(isFinalized(asst('a', false))).toBe(true);
  });
  it('finalizes tool on done/error, not start', () => {
    expect(isFinalized(tool('t', 'start'))).toBe(false);
    expect(isFinalized(tool('t', 'done'))).toBe(true);
    expect(isFinalized(tool('t', 'error'))).toBe(true);
  });
});

describe('partition', () => {
  it('commits everything when all entries are finalized', () => {
    const e = [user('u'), asst('a', false), tool('t', 'done')];
    expect(partition(e)).toEqual({ committed: e, live: [] });
  });

  it('holds the streaming tail in the live region', () => {
    const e = [user('u'), asst('a', true)];
    const { committed, live } = partition(e);
    expect(committed.map((x) => x.id)).toEqual(['u']);
    expect(live.map((x) => x.id)).toEqual(['a']);
  });

  it('is a PREFIX split: a later finalized entry stays live behind an earlier live one', () => {
    // assistant 'a' is still streaming; tool 't' after it is already done.
    // A naive filter would commit 't' out of order; the prefix split must not.
    const e = [user('u'), asst('a', true), tool('t', 'done')];
    const { committed, live } = partition(e);
    expect(committed.map((x) => x.id)).toEqual(['u']);
    expect(live.map((x) => x.id)).toEqual(['a', 't']);
  });

  it('commits the assistant once it stops streaming', () => {
    const e = [user('u'), asst('a', false), tool('t', 'start')];
    const { committed, live } = partition(e);
    expect(committed.map((x) => x.id)).toEqual(['u', 'a']);
    expect(live.map((x) => x.id)).toEqual(['t']);
  });
});
