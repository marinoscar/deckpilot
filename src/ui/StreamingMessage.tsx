import React from 'react';
import { Box, Text } from 'ink';

type Props = { text: string; streaming: boolean };

export const StreamingMessage: React.FC<Props> = ({ text, streaming }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>
        deckpilot{streaming ? ' ▌' : ''}
      </Text>
      <Text>{text}</Text>
    </Box>
  );
};
