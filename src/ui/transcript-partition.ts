/**
 * Splits the transcript into a "committed" prefix (finalized entries that can be
 * printed once into the terminal's native scrollback via ink's <Static>) and a
 * "live" tail that React keeps re-rendering (the streaming assistant message, a
 * tool still running, etc.).
 *
 * Why a PREFIX split and not a filter: ink's <Static> is append-only and keyed
 * off `items.length`. It only ever renders items appended past its internal
 * high-water mark, and never re-renders or reorders what it already printed. So
 * the committed array must grow by appending, in transcript order. If a later
 * entry finalized before an earlier one (e.g. a tool completes while the
 * assistant above it is still streaming) a filter would commit it out of order
 * and desync Static's slice index — double-printing or dropping lines. Holding
 * everything from the first non-finalized entry onward in the live region keeps
 * the invariant: committed only ever grows at the end.
 */
import type { TranscriptEntry } from '../chat/session-types.js';

/** True once an entry will never change again and is safe to commit to scrollback. */
export function isFinalized(e: TranscriptEntry): boolean {
  switch (e.kind) {
    case 'assistant':
      return e.streaming === false;
    case 'tool':
      return e.status !== 'start';
    default:
      // user / system / preview are immutable the moment they're pushed.
      return true;
  }
}

export type Partition = {
  committed: TranscriptEntry[];
  live: TranscriptEntry[];
};

/** Prefix-split at the first non-finalized entry. */
export function partition(entries: TranscriptEntry[]): Partition {
  const firstLive = entries.findIndex((e) => !isFinalized(e));
  if (firstLive === -1) return { committed: entries, live: [] };
  return { committed: entries.slice(0, firstLive), live: entries.slice(firstLive) };
}
