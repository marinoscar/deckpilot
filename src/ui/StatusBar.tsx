import { Box, Text } from 'ink';
import type React from 'react';

type Props = {
  status: 'idle' | 'streaming' | 'cancelled' | 'error';
  model: string;
  project?: string | null;
  template?: string | null;
  hint?: string;
};

export const StatusBar: React.FC<Props> = ({ status, model, project, template, hint }) => {
  const color =
    status === 'streaming'
      ? 'cyan'
      : status === 'error'
        ? 'red'
        : status === 'cancelled'
          ? 'yellow'
          : 'gray';
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} dimColor={status === 'idle'}>
          [{status}]
        </Text>
        <Text> </Text>
        <Text color="blue">model: {model}</Text>
        {project ? (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text color="green">project: {project}</Text>
          </>
        ) : null}
        {template ? (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text color="magenta">template: {template}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text dimColor>{hint ?? '· Ctrl+C cancels; double Ctrl+C exits · /help for commands'}</Text>
      </Box>
    </Box>
  );
};
