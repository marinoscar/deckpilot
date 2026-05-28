import { Box, Text } from 'ink';
import type React from 'react';
import type { TranscriptEntry } from '../chat/session.js';
import { StreamingMessage } from './StreamingMessage.js';

type Props = { entries: TranscriptEntry[] };

export const Transcript: React.FC<Props> = ({ entries }) => {
  return (
    <Box flexDirection="column">
      {entries.map((e) => {
        switch (e.kind) {
          case 'user':
            return (
              <Box key={e.id} flexDirection="column" marginBottom={1}>
                <Text color="green" bold>
                  you
                </Text>
                <Text>{e.text}</Text>
              </Box>
            );
          case 'assistant':
            return <StreamingMessage key={e.id} text={e.text} streaming={e.streaming} />;
          case 'tool':
            return (
              <Box key={e.id} flexDirection="column" marginBottom={1}>
                <Text color={e.status === 'error' ? 'red' : 'magenta'}>
                  → tool {e.tool} {e.status === 'start' ? '…' : e.status === 'done' ? '✓' : '✗'}
                </Text>
                {e.detail ? (
                  <Box marginLeft={2}>
                    <Text color={e.status === 'error' ? 'red' : undefined} dimColor>
                      {e.detail}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            );
          case 'system':
            return (
              <Box key={e.id} marginBottom={1}>
                <Text color="yellow">{e.text}</Text>
              </Box>
            );
          case 'preview':
            return (
              <Box key={e.id} marginBottom={1}>
                <Text color="cyanBright">
                  🖼 slide {e.slideId} · pass {e.pass} · file://{e.pngPath}
                </Text>
              </Box>
            );
        }
      })}
    </Box>
  );
};
