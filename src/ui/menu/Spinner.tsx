import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Theme } from '../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

type Props = {
  /** Label shown next to the spinner. Defaults to "Loading". */
  label?: string;
  /** Override the spinner colour. Defaults to the primary theme accent. */
  color?: string;
};

/**
 * Compact inline spinner for short-running async work (loading lists,
 * saving config, etc.). Visually distinct from the chat-mode
 * ThinkingIndicator which has its own deck-flavoured verb cycle.
 */
export const Spinner: React.FC<Props> = ({ label = 'Loading', color = Theme.primary }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <Box>
      <Text color={color}>{FRAMES[frame]}</Text>
      <Text dimColor>{` ${label}…`}</Text>
    </Box>
  );
};
