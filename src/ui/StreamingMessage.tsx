import { Box, Text } from 'ink';
import type React from 'react';
import { Theme } from './theme.js';

type Props = { text: string; streaming: boolean };

/**
 * Assistant message in the Claude-Code idiom: a `⏺` bullet followed by plain
 * text (no "deckpilot" header). While streaming, a solid block caret trails the
 * text; once finalized the caret is gone and the line is byte-for-byte what the
 * committed (Static) render produces — so the live → scrollback handoff doesn't
 * flicker or reflow.
 */
export const StreamingMessage: React.FC<Props> = ({ text, streaming }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={Theme.primary}>{'⏺ '}</Text>
        <Text>
          {text}
          {streaming ? <Text inverse> </Text> : null}
        </Text>
      </Box>
    </Box>
  );
};
