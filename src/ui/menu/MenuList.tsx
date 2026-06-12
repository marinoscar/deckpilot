import { Box, Text } from 'ink';
import { useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { Theme } from '../theme.js';

export type MenuItem<V> = {
  /** The value handed back to onSelect when this item is activated. */
  value: V;
  /** Primary label. */
  label: string;
  /** Optional secondary text — shown dim on a single line below the list for
   *  the *active* item only, so long descriptions never collide with labels. */
  detail?: string;
  /** Optional one-character hotkey users can press to jump-activate this item. */
  hotkey?: string;
  /** Disable navigation onto this item (used for visual separators). */
  separator?: boolean;
};

type Props<V> = {
  items: MenuItem<V>[];
  /** Fires on Enter or hotkey press. */
  onSelect: (value: V) => void;
  /** Fires on Esc / `b` — your screen decides what "back" means. */
  onBack?: () => void;
  /** Optional starting index (default 0, or first non-separator). */
  initialIndex?: number;
};

const CURSOR = '❯';

/**
 * Reusable vertical menu. Up/Down to navigate, Enter to activate, hotkeys
 * (1-9, a-z) jump to + activate, Esc backs out. Separator items are
 * unselectable. Renders a clean single column: the active row is marked with a
 * `❯` cursor in the accent colour, and the active item's `detail` (if any) shows
 * as one dim line below the list — no right-aligned column that can wrap or
 * overlap the labels.
 */
export function MenuList<V>({
  items,
  onSelect,
  onBack,
  initialIndex,
}: Props<V>): React.ReactElement {
  const firstSelectable = items.findIndex((i) => !i.separator);
  const start = initialIndex ?? (firstSelectable >= 0 ? firstSelectable : 0);
  const [index, setIndex] = useState(start);

  const next = (from: number, dir: 1 | -1): number => {
    let n = from;
    for (let i = 0; i < items.length; i++) {
      n = (n + dir + items.length) % items.length;
      if (!items[n]?.separator) return n;
    }
    return from;
  };

  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => next(i, -1));
    else if (key.downArrow) setIndex((i) => next(i, 1));
    else if (key.return) {
      const item = items[index];
      if (item && !item.separator) onSelect(item.value);
    } else if (key.escape) {
      onBack?.();
    } else if (input === 'b' && onBack) {
      // Standardised back binding. NOTE: `q` is intentionally NOT a back
      // binding any more — screens that want `q` to do something specific
      // (e.g. MainMenu's Quit row) wire it as a MenuItem.hotkey instead.
      onBack();
    } else if (input) {
      // Hotkey activation
      const hit = items.findIndex(
        (it) => !it.separator && it.hotkey && it.hotkey.toLowerCase() === input.toLowerCase(),
      );
      if (hit >= 0) {
        setIndex(hit);
        const item = items[hit]!;
        onSelect(item.value);
      }
    }
  });

  const activeDetail = items[index]?.detail;

  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        if (it.separator) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no value
            <Box key={`sep-${i}`}>
              <Text dimColor>{it.label}</Text>
            </Box>
          );
        }
        const active = i === index;
        return (
          <Box key={String(it.value)}>
            <Text color={active ? Theme.primary : undefined} bold={active}>
              {active ? `${CURSOR} ` : '  '}
              {it.label}
            </Text>
            {it.hotkey ? <Text dimColor>{`  (${it.hotkey})`}</Text> : null}
          </Box>
        );
      })}
      {activeDetail ? (
        <Box marginTop={1}>
          <Text dimColor>{activeDetail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
