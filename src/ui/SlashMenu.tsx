import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { type SlashCommandMeta, filterSlashCommands, slashLabel } from '../chat/slash.js';
import { Theme } from './theme.js';

type Props = {
  /** Text typed after the leading `/` (drives the filter). */
  query: string;
  selectedIndex: number;
  /** Reports the current filtered list so the prompt can act on Enter/Tab. */
  onResolve: (filtered: SlashCommandMeta[]) => void;
};

const MAX_VISIBLE = 8;
const ACCENT = Theme.primary;

/**
 * Popup-style slash-command list. Stateless about input — the prompt routes
 * keypresses to it and reads the filtered list back via `onResolve`. Mirrors
 * the shape of `FilePicker`.
 */
export const SlashMenu: React.FC<Props> = ({ query, selectedIndex, onResolve }) => {
  const filtered = filterSlashCommands(query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the query string only.
  useEffect(() => {
    onResolve(filtered);
  }, [query]);

  if (filtered.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color="yellow">/ no command matches "{query}" — try /help</Text>
      </Box>
    );
  }

  // Window the visible slice so the selected row stays in view.
  const start = Math.max(0, Math.min(selectedIndex - 3, filtered.length - MAX_VISIBLE));
  const visible = filtered.slice(start, start + MAX_VISIBLE);
  const labelWidth = Math.max(...filtered.map((c) => slashLabel(c).length));

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor={ACCENT}
      paddingX={1}
    >
      <Text color={ACCENT} bold>
        / {filtered.length} command{filtered.length === 1 ? '' : 's'} (↑/↓ select · Tab complete ·
        Enter run · Esc cancel)
      </Text>
      {visible.map((cmd, i) => {
        const realIndex = start + i;
        const sel = realIndex === selectedIndex;
        return (
          <Box key={cmd.name}>
            <Text color={sel ? `${ACCENT}Bright` : 'gray'}>{sel ? '› ' : '  '}</Text>
            <Text color={sel ? 'white' : ACCENT} bold={sel}>
              {slashLabel(cmd).padEnd(labelWidth)}
            </Text>
            <Text dimColor={!sel} color={sel ? 'white' : undefined}>
              {'  '}
              {cmd.summary}
            </Text>
          </Box>
        );
      })}
      {filtered.length > visible.length ? (
        <Text dimColor>… {filtered.length - visible.length} more (type to filter)</Text>
      ) : null}
    </Box>
  );
};
