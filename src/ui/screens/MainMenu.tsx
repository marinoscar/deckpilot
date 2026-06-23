import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { listProjects } from '../../store/projects.js';
import type { UpdateInfo } from '../../util/version-check.js';
import { Banner } from '../menu/Banner.js';
import { type MenuItem, MenuList } from '../menu/MenuList.js';
import { Panel } from '../menu/Panel.js';
import { Theme } from '../theme.js';

export type MainChoice =
  | 'start'
  | 'transform'
  | 'improve'
  | 'resume'
  | 'projects'
  | 'templates'
  | 'skills'
  | 'settings'
  | 'doctor'
  | 'help'
  | 'quit';

type Props = {
  busy?: boolean;
  /** When set, a newer DeckPilot is available — shown as a banner notice. */
  update?: UpdateInfo | null;
  onPick: (choice: MainChoice) => void;
};

const TAGLINE = 'Conversational PowerPoint, powered by GitHub Copilot';
const PANEL_WIDTH = 76;

/** A compact rounded info box (workspace + saved project count). */
const InfoBox: React.FC<{ projectCount: number | null }> = ({ projectCount }) => (
  <Box
    borderStyle="round"
    borderColor={Theme.primary}
    flexDirection="column"
    paddingX={2}
    paddingY={0}
    marginX={1}
    marginBottom={1}
    width={PANEL_WIDTH}
  >
    <Box>
      <Text dimColor>Workspace</Text>
      <Text>{'   '}</Text>
      <Text color={Theme.primary}>{process.cwd()}</Text>
    </Box>
    <Box>
      <Text dimColor>Projects </Text>
      <Text>{'   '}</Text>
      <Text>{projectCount === null ? 'loading…' : `${projectCount} saved`}</Text>
    </Box>
  </Box>
);

/** A friendly "you're a version behind" notice, shown only when an update exists. */
const UpdateNotice: React.FC<{ update: UpdateInfo }> = ({ update }) => (
  <Box
    borderStyle="round"
    borderColor={Theme.warn}
    flexDirection="column"
    paddingX={2}
    marginX={1}
    marginBottom={1}
    width={PANEL_WIDTH}
  >
    <Text color={Theme.warn}>
      ✨ DeckPilot v{update.latest} is available <Text dimColor>(you have v{update.current})</Text>
    </Text>
    <Text dimColor>Re-run the installer to update — see docs/INSTALL.md.</Text>
  </Box>
);

export const MainMenu: React.FC<Props> = ({ busy, update, onPick }) => {
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listProjects().then((list) => {
      if (cancelled) return;
      setProjectCount(list.length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeDetail =
    projectCount === null
      ? 'Loading saved projects…'
      : projectCount === 0
        ? 'No saved projects yet'
        : `${projectCount} saved · newest first`;

  const items: MenuItem<MainChoice>[] = [
    {
      value: 'start',
      label: 'Start a new deck',
      detail: 'Open chat and build a deck from scratch',
      hotkey: 's',
    },
    {
      value: 'transform',
      label: 'Transform a deck',
      detail: "Restyle a deck's content 1:1 into a template's look",
      hotkey: 'x',
    },
    {
      value: 'improve',
      label: 'Improve a deck',
      detail: 'Quality-check a deck and rebuild a better version',
      hotkey: 'i',
    },
    {
      value: 'resume',
      label: 'Resume a deck',
      detail: resumeDetail,
      hotkey: 'r',
    },
    {
      value: 'projects',
      label: 'Manage projects',
      detail: 'Browse, inspect, or delete saved decks',
      hotkey: 'p',
    },
    {
      value: 'templates',
      label: 'Manage templates',
      detail: 'Brands, palettes, fonts, voice / copy rules',
      hotkey: 't',
    },
    {
      value: 'skills',
      label: 'Manage skills',
      detail: 'Staged AI instructions: intake, per-slide checks, final review',
      hotkey: 'k',
    },
    {
      value: 'settings',
      label: 'Settings',
      detail: 'Defaults, critique budget, paths',
      hotkey: 'g',
    },
    {
      value: 'doctor',
      label: 'Doctor',
      detail: 'Preflight diagnostics: Node, auth, Copilot SDK, preview',
      hotkey: 'd',
    },
    {
      value: 'help',
      label: 'Help',
      detail: 'Commands, key bindings, docs',
      hotkey: 'h',
    },
    {
      value: 'quit',
      label: 'Quit',
      detail: 'Exit DeckPilot',
      hotkey: 'q',
    },
  ];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Banner tagline={TAGLINE} />
      <InfoBox projectCount={projectCount} />
      {update ? <UpdateNotice update={update} /> : null}
      <Panel
        title="Menu"
        subtitle="Use arrow keys and Enter to navigate"
        footer="↑/↓ navigate · Enter select · letter shortcut to jump · q quit"
        width={PANEL_WIDTH}
      >
        <MenuList items={items} onSelect={(choice) => onPick(choice)} />
        {busy ? (
          <Box marginTop={1}>
            <Text color="yellow">starting session …</Text>
          </Box>
        ) : null}
      </Panel>
    </Box>
  );
};
