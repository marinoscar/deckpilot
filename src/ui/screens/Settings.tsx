import { existsSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { findStyleGuidePath } from '../../config/project.js';
import { homeRoot, projectsRoot, templatesRoot } from '../../store/paths.js';
import { Panel } from '../menu/Panel.js';

type Props = {
  onBack: () => void;
};

export const Settings: React.FC<Props> = ({ onBack }) => {
  const [styleGuidePath, setStyleGuidePath] = useState<string | null>(null);

  useEffect(() => {
    setStyleGuidePath(findStyleGuidePath());
  }, []);

  useInput((_input, key) => {
    if (key.escape) onBack();
  });
  useInput((input) => {
    if (input === 'b' || input === 'q') onBack();
  });

  const home = homeRoot();

  return (
    <Panel title="Settings" subtitle="paths · defaults · style guide" footer="b/Esc back">
      <Box flexDirection="column">
        <Section title="DeckPilot home">
          <Row label="root" value={home} />
          <Row label="projects" value={projectsRoot()} />
          <Row label="templates" value={templatesRoot()} />
          <Row label="DECKPILOT.md" value={styleGuidePath ?? '(none in this directory tree)'} />
          {styleGuidePath ? (
            <Box marginTop={1}>
              <Text dimColor>
                The DECKPILOT.md above is loaded automatically as binding style guidance whenever
                you start chat from this directory tree.
              </Text>
            </Box>
          ) : null}
        </Section>

        <Box marginTop={1}>
          <Section title="Critique budget">
            <Text dimColor>
              Default: 3 passes per slide. Adjust with `--critique-passes &lt;n&gt;` on the CLI or
              `/critique-passes &lt;n&gt;` mid-chat.
            </Text>
          </Section>
        </Box>

        <Box marginTop={1}>
          <Section title="Model">
            <Text dimColor>
              DeckPilot uses whatever model your Copilot CLI is configured for unless you override
              with `--model &lt;id&gt;` on the CLI or `/model &lt;id&gt;` mid-chat. Run `deckpilot
              models` for the list.
            </Text>
          </Section>
        </Box>

        <Box marginTop={1}>
          <Section title="Environment overrides">
            <Row label="DECKPILOT_HOME" value={process.env.DECKPILOT_HOME ?? '(unset)'} />
            <Row
              label="COPILOT_GITHUB_TOKEN"
              value={process.env.COPILOT_GITHUB_TOKEN ? '(set)' : '(unset)'}
            />
          </Section>
        </Box>

        {!existsSync(home) ? (
          <Box marginTop={1}>
            <Text dimColor>~/.deckpilot/ doesn't exist yet — it's created on first use.</Text>
          </Box>
        ) : null}
      </Box>
    </Panel>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box flexDirection="column">
    <Text color="magenta" bold>
      {title}
    </Text>
    <Box flexDirection="column">{children}</Box>
  </Box>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box>
    <Text dimColor>{label.padEnd(22)}</Text>
    <Text>{value}</Text>
  </Box>
);
