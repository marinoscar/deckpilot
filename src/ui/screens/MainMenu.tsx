import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { listProjects } from '../../store/projects.js';
import { type MenuItem, MenuList } from '../menu/MenuList.js';
import { Panel } from '../menu/Panel.js';

export type MainChoice =
  | 'start'
  | 'resume'
  | 'projects'
  | 'templates'
  | 'settings'
  | 'help'
  | 'quit';

type Props = {
  busy?: boolean;
  onPick: (choice: MainChoice, payload?: { projectName?: string }) => void;
};

const TAGLINE = 'conversational PowerPoint, powered by GitHub Copilot';

export const MainMenu: React.FC<Props> = ({ busy, onPick }) => {
  const [lastProject, setLastProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void listProjects().then((list) => {
      if (cancelled) return;
      setLastProject(list[0]?.name ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items: MenuItem<MainChoice>[] = [
    {
      value: 'start',
      label: 'Start a new deck',
      detail: 'Open chat and build a deck from scratch',
      hotkey: 's',
    },
    lastProject
      ? {
          value: 'resume',
          label: `Resume "${lastProject}"`,
          detail: 'Pick up where you left off, with full LLM memory',
          hotkey: 'r',
        }
      : {
          value: 'resume',
          label: 'Resume a deck',
          detail: loading ? 'Loading saved projects…' : 'No saved projects yet',
          hotkey: 'r',
          separator: !loading && !lastProject ? true : undefined,
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
      value: 'settings',
      label: 'Settings',
      detail: 'Defaults, critique budget, paths',
      hotkey: 'g',
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
    <Panel
      title="DeckPilot"
      subtitle={TAGLINE}
      footer="↑/↓ navigate · Enter select · letter shortcut to jump · q quit"
    >
      <MenuList
        items={items}
        onSelect={(choice) =>
          choice === 'resume' && lastProject
            ? onPick('resume', { projectName: lastProject })
            : onPick(choice)
        }
        twoColumn
      />
      {busy ? (
        <Box marginTop={1}>
          <Text color="yellow">starting session …</Text>
        </Box>
      ) : null}
    </Panel>
  );
};
