import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { Panel } from '../menu/Panel.js';

type Props = {
  onBack: () => void;
};

export const Help: React.FC<Props> = ({ onBack }) => {
  useInput((input, key) => {
    if (key.escape || input === 'b' || input === 'q') onBack();
  });

  return (
    <Panel title="Help" subtitle="key bindings · CLI commands · slash commands" footer="b/Esc back">
      <Box flexDirection="column">
        <Section title="Menu navigation (this UI)">
          <Line k="↑ / ↓" v="navigate" />
          <Line k="Enter" v="activate the highlighted item" />
          <Line k="letter shortcut" v="jump to + activate (shown in the menu)" />
          <Line k="b / Esc" v="go back one screen" />
          <Line k="q" v="quit from main menu" />
        </Section>

        <Spacer />

        <Section title="CLI commands">
          <Line k="deckpilot" v="open this menu" />
          <Line k="deckpilot start [name]" v="start a new deck (alias: chat)" />
          <Line k="deckpilot resume <name>" v="resume a saved project with full LLM memory" />
          <Line k="deckpilot project list / show / delete" v="manage saved projects" />
          <Line k="deckpilot template list / show / create / delete" v="manage named templates" />
          <Line k="deckpilot render <brief.json>" v="render a saved brief to .pptx (headless)" />
          <Line k="deckpilot doctor" v="preflight diagnostics" />
          <Line k="deckpilot auth login" v="GitHub Copilot auth" />
        </Section>

        <Spacer />

        <Section title="Inside chat (slash commands)">
          <Line k="/outline" v="compact deck outline" />
          <Line k="/show" v="full brief as JSON" />
          <Line k="/render [path]" v="render the current deck to .pptx" />
          <Line k="/save [name]" v="force-flush autosave / rename project" />
          <Line k="/project [name]" v="show / rename current project" />
          <Line k="/templates" v="list saved templates" />
          <Line k="/template [name|path|none]" v="switch / clear template mid-session" />
          <Line k="/critique-passes <n>" v="adjust per-slide critique budget" />
          <Line k="/undo" v="roll back the last deck change" />
          <Line k="/help" v="full slash command reference" />
        </Section>

        <Spacer />

        <Section title="Docs">
          <Line k="docs/TEMPLATE_SPEC.md" v="full TemplateSpec schema with worked examples" />
          <Line k="DECKPILOT.md" v="per-directory style guide (auto-loaded if present)" />
        </Section>
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

const Spacer: React.FC = () => <Box marginTop={1} />;

const Line: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <Box>
    <Text color="cyanBright">{k.padEnd(38)}</Text>
    <Text dimColor>{v}</Text>
  </Box>
);
