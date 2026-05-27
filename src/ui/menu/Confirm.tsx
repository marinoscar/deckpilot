import { Box, Text, useInput } from 'ink';
import type React from 'react';

type Props = {
  question: string;
  /** y/Y/Enter → confirm, n/N/Esc → cancel. */
  onResolve: (confirmed: boolean) => void;
  danger?: boolean;
};

/**
 * Inline y/N confirmation. Default is N (the safer choice). Used for
 * destructive operations like project / template deletion.
 */
export const Confirm: React.FC<Props> = ({ question, onResolve, danger = false }) => {
  useInput((input, key) => {
    if (key.return) {
      // Default: NO on Enter (safer for destructive ops).
      onResolve(false);
      return;
    }
    if (key.escape) {
      onResolve(false);
      return;
    }
    if (input === 'y' || input === 'Y') {
      onResolve(true);
    } else if (input === 'n' || input === 'N') {
      onResolve(false);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={danger ? 'red' : 'yellow'} bold>
        {question}
      </Text>
      <Text dimColor>y to confirm · n/Esc/Enter to cancel</Text>
    </Box>
  );
};
