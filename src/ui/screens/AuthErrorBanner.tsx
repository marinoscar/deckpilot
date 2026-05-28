import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { Panel } from '../menu/Panel.js';

type Props = {
  message: string;
  onRetry: () => void;
  onBack: () => void;
};

/**
 * Shown by RootApp when `session.start()` fails with an auth-shaped error.
 * The chat UI never mounts — the user sees a focused recovery screen
 * with one clear next step (run `deckpilot auth login`).
 */
export const AuthErrorBanner: React.FC<Props> = ({ message, onRetry, onBack }) => {
  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (input === 'r' || input === 'R') {
      onRetry();
      return;
    }
  });

  return (
    <Panel
      title="Authentication needed"
      subtitle="Copilot session could not be started"
      footer="r retry · b/Esc back to menu"
      accent="red"
    >
      <Box flexDirection="column">
        <Text color="red">{message}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>To fix:</Text>
          <Text>
            <Text color="cyanBright">1.</Text> Open another terminal and run:
          </Text>
          <Box marginLeft={3}>
            <Text color="cyanBright">deckpilot auth login</Text>
          </Box>
          <Text>
            <Text color="cyanBright">2.</Text> Complete the GitHub device-flow login.
          </Text>
          <Text>
            <Text color="cyanBright">3.</Text> Come back here and press <Text bold>r</Text> to
            retry.
          </Text>
        </Box>
      </Box>
    </Panel>
  );
};
