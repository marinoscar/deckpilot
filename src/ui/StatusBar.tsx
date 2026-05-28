import { Box, Text } from 'ink';
import type React from 'react';
import type { SaveState } from '../chat/session.js';

type Props = {
  status: 'idle' | 'streaming' | 'cancelled' | 'error';
  model: string;
  project?: string | null;
  template?: string | null;
  saveState?: SaveState | null;
  hint?: string;
};

export const StatusBar: React.FC<Props> = ({
  status,
  model,
  project,
  template,
  saveState,
  hint,
}) => {
  const color =
    status === 'streaming'
      ? 'cyan'
      : status === 'error'
        ? 'red'
        : status === 'cancelled'
          ? 'yellow'
          : 'gray';

  const saveDotColor =
    saveState === 'saving'
      ? 'yellow'
      : saveState === 'failed'
        ? 'red'
        : saveState === 'saved'
          ? 'green'
          : 'gray';

  const saveLabel =
    saveState === 'saving'
      ? 'saving'
      : saveState === 'failed'
        ? 'save failed'
        : saveState === 'saved'
          ? 'saved'
          : 'idle';

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
        {project && saveState ? (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text color={saveDotColor}>●</Text>
            <Text dimColor> {saveLabel}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text dimColor>{hint ?? '· Ctrl+C cancels; double Ctrl+C exits · /help for commands'}</Text>
      </Box>
    </Box>
  );
};
