import React from 'react';
import { Box, Text } from 'ink';

type Props = { status: 'idle' | 'streaming' | 'cancelled' | 'error'; hint?: string };

export const StatusBar: React.FC<Props> = ({ status, hint }) => {
  const color =
    status === 'streaming'
      ? 'cyan'
      : status === 'error'
        ? 'red'
        : status === 'cancelled'
          ? 'yellow'
          : 'gray';
  return (
    <Box>
      <Text color={color} dimColor={status === 'idle'}>
        [{status}] {hint ?? 'Ctrl+C cancels; double Ctrl+C exits. /help for commands.'}
      </Text>
    </Box>
  );
};
