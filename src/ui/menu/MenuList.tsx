import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';

export type MenuItem<V> = {
  /** The value handed back to onSelect when this item is activated. */
  value: V;
  /** Primary label (left column, bold when active). */
  label: string;
  /** Optional secondary text (right column or below, dim). */
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
  /** Fires on Esc / `b` / `q` — your screen decides what "back" means. */
  onBack?: () => void;
  /** Optional starting index (default 0, or first non-separator). */
  initialIndex?: number;
  /** Two-column layout: when true, detail right-aligns instead of dim-grey trailing. */
  twoColumn?: boolean;
};

/**
 * Reusable vertical menu. Up/Down to navigate, Enter to activate, hotkeys
 * (1-9, a-z) jump to + activate, Esc backs out. Separator items are
 * unselectable.
 */
export function MenuList<V>({
  items,
  onSelect,
  onBack,
  initialIndex,
  twoColumn = false,
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

  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        if (it.separator) {
          return (
            <Box key={`sep-${i}`} marginY={0}>
              <Text dimColor>{it.label}</Text>
            </Box>
          );
        }
        const active = i === index;
        const marker = active ? '▸' : ' ';
        const labelColor = active ? 'cyanBright' : undefined;
        if (twoColumn) {
          return (
            <Box key={String(it.value)} justifyContent="space-between">
              <Box>
                <Text color={labelColor} bold={active}>
                  {marker} {it.label}
                </Text>
                {it.hotkey ? <Text dimColor>{`  (${it.hotkey})`}</Text> : null}
              </Box>
              {it.detail ? <Text dimColor>{it.detail}</Text> : null}
            </Box>
          );
        }
        return (
          <Box key={String(it.value)}>
            <Text color={labelColor} bold={active}>
              {marker} {it.label}
            </Text>
            {it.detail ? (
              <>
                <Text dimColor>{'   '}</Text>
                <Text dimColor>{it.detail}</Text>
              </>
            ) : null}
            {it.hotkey ? <Text dimColor>{`  (${it.hotkey})`}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
