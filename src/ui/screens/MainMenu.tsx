import { Box, Text } from 'ink';
import type React from 'react';
import { MenuList } from '../menu/MenuList.js';
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
  onPick: (choice: MainChoice) => void;
};

const TAGLINE = 'conversational PowerPoint, powered by GitHub Copilot';

const ITEMS: { value: MainChoice; label: string; detail?: string; hotkey?: string }[] = [
  {
    value: 'start',
    label: 'Start a new deck',
    detail: 'Open chat and build a deck from scratch',
    hotkey: 's',
  },
  { value: 'resume', label: 'Resume a deck', detail: 'Pick up where you left off', hotkey: 'r' },
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
  { value: 'settings', label: 'Settings', detail: 'Defaults, critique budget, paths', hotkey: 'g' },
  { value: 'help', label: 'Help', detail: 'Commands, key bindings, docs', hotkey: 'h' },
  { value: 'quit', label: 'Quit', detail: 'Exit DeckPilot', hotkey: 'q' },
];

export const MainMenu: React.FC<Props> = ({ busy, onPick }) => {
  return (
    <Panel
      title="DeckPilot"
      subtitle={TAGLINE}
      footer="↑/↓ navigate · Enter select · letter shortcut to jump · q quit"
    >
      <MenuList items={ITEMS} onSelect={onPick} twoColumn />
      {busy ? (
        <Box marginTop={1}>
          <Text color="yellow">starting session …</Text>
        </Box>
      ) : null}
    </Panel>
  );
};
