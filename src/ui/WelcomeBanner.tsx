import { Box, Text } from 'ink';
import type React from 'react';
import { Theme } from './theme.js';

/**
 * One-time welcome shown at the top of the chat scrollback — a rounded cyan
 * box with the product line, in the Claude-Code idiom.
 */
export const WelcomeBanner: React.FC = () => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor={Theme.primary} paddingX={1} alignSelf="flex-start">
        <Text color={Theme.primary} bold>
          ✻ DeckPilot
        </Text>
        <Text dimColor> · conversational PowerPoint via GitHub Copilot</Text>
      </Box>
      <Text dimColor>{'  '}Describe a deck, or type /help for commands.</Text>
    </Box>
  );
};
