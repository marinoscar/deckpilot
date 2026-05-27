import { Box, Text } from 'ink';
import type React from 'react';

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
