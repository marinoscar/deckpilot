import { Box, Text } from 'ink';
import type React from 'react';
import { Theme } from '../theme.js';

// Figlet "Standard" rendering of "DeckPilot". String.raw keeps the backslashes
// literal so the art isn't mangled by JS escapes.
const LOGO = String.raw`  ____            _    ____  _ _       _
 |  _ \  ___  ___| | _|  _ \(_) | ___ | |_
 | | | |/ _ \/ __| |/ / |_) | | |/ _ \| __|
 | |_| |  __/ (__|   <|  __/| | | (_) | |_
 |____/ \___|\___|_|\_\_|   |_|_|\___/ \__|`;

type Props = {
  /** Dim tagline shown under the logo. */
  tagline?: string;
};

/** Big cyan ASCII wordmark + tagline for the top of the home screen. */
export const Banner: React.FC<Props> = ({ tagline }) => {
  const lines = LOGO.split('\n');
  return (
    <Box flexDirection="column" marginLeft={1} marginBottom={1}>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static art, stable order
        <Text key={i} color={Theme.primary}>
          {line}
        </Text>
      ))}
      {tagline ? <Text dimColor>{`  ${tagline}`}</Text> : null}
    </Box>
  );
};
