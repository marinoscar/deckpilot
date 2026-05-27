import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Cute, deck-themed status words. Rotated every few seconds so a long-running
 * agent turn doesn't feel stuck. Mix of generic "thinking" verbs and DeckPilot
 * flavor — slides, fonts, bullets, charts.
 */
const VERBS = [
  'Thinking',
  'Pondering',
  'Cogitating',
  'Mulling',
  'Brewing slides',
  'Storyboarding',
  'Drafting bullets',
  'Picking a layout',
  'Choosing fonts',
  'Sprinkling pixie dust',
  'Aligning everything',
  'Polishing the title',
  'Workshopping copy',
  'Centering text',
  'Slotting bullets',
  'Squinting at fonts',
  'Whittling the outline',
  'Garnishing with charts',
  'Untangling ideas',
  'Marinating concepts',
  'Negotiating with bullet points',
  'Shooing comic sans away',
  'Counting slides on its fingers',
  'Color-matching the title bar',
  'Reading the room',
  'Channeling Edward Tufte',
];

const SPIN_MS = 80;
const VERB_MS = 3500;

export const ThinkingIndicator: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const [verbIndex, setVerbIndex] = useState(() => Math.floor(Math.random() * VERBS.length));
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    const spinTimer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, SPIN_MS);
    const verbTimer = setInterval(() => {
      setVerbIndex((i) => (i + 1) % VERBS.length);
    }, VERB_MS);
    return () => {
      clearInterval(spinTimer);
      clearInterval(verbTimer);
    };
  }, []);

  return (
    <Box>
      <Text color="cyan">{SPINNER[frame]} </Text>
      <Text color="cyan" bold>
        {VERBS[verbIndex]}
      </Text>
      <Text color="cyan">…</Text>
      <Text dimColor> ({elapsed}s · Ctrl+C to cancel)</Text>
    </Box>
  );
};
