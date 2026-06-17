import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { SaveState } from '../chat/session.js';

type Props = {
  status: 'idle' | 'streaming' | 'cancelled' | 'error';
  model: string;
  project?: string | null;
  template?: string | null;
  saveState?: SaveState | null;
  hint?: string;
};

/** Always-visible key hints (row A of the footer). */
const KEY_HINTS = '/ commands · @ files · ⏎ send · \\ + ⏎ newline · esc interrupt · /help';

/** Rotating feature tips (row B of the footer) — teaches the surface over time. */
const TIPS = [
  'type / to see every command, then ↑/↓ and Enter to run one',
  '@ inserts a workspace file path so the model can reference it',
  '/doc attaches a .txt/.md/.pptx/.docx as text context for your next message',
  '/image attaches pictures the model can actually see',
  '/template <name> applies a saved brand template mid-session',
  '/render writes the current deck to a .pptx in this folder',
  '/save renames the project; decks autosave to ~/.deckpilot/ already',
  'end a line with \\ then Enter for a multi-line message; Enter alone sends',
  '/critique <id> makes the agent re-preview and polish one slide',
  'resume any deck later with: deckpilot resume <name>',
];

const TIP_MS = 6000;

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

  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, TIP_MS);
    return () => clearInterval(timer);
  }, []);

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
        <Text dimColor>{hint ?? KEY_HINTS}</Text>
      </Box>
      <Box>
        <Text dimColor>💡 Tip: {TIPS[tipIndex]}</Text>
      </Box>
    </Box>
  );
};
