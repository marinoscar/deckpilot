import { Box, Text, render, useApp, useInput } from 'ink';
import React, { useState } from 'react';
import { summarizeSkill } from '../skill/spec.js';
import type { SkillListEntry } from '../store/skills.js';

type Choice = { kind: 'skip' } | { kind: 'skill'; entry: SkillListEntry };

type Props = {
  entries: SkillListEntry[];
  onResolve: (skillName: string | undefined) => void;
};

const PickerComponent: React.FC<Props> = ({ entries, onResolve }) => {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);

  const choices: Choice[] = [
    { kind: 'skip' },
    ...entries.map((e) => ({ kind: 'skill' as const, entry: e })),
  ];

  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(choices.length - 1, i + 1));
    else if (key.return) {
      const sel = choices[index]!;
      onResolve(sel.kind === 'skip' ? undefined : sel.entry.name);
      exit();
    } else if (key.escape) {
      onResolve(undefined);
      exit();
    } else if (input === 'q') {
      onResolve(undefined);
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Pick a skill (staged AI instructions) — or skip:</Text>
      <Box flexDirection="column" marginTop={1}>
        {choices.map((c, i) => {
          const active = i === index;
          const marker = active ? '▸' : ' ';
          if (c.kind === 'skip') {
            return (
              <Text key="skip" color={active ? 'cyanBright' : undefined}>
                {marker} No skill {active ? '(default)' : ''}
              </Text>
            );
          }
          const tag = c.entry.builtin ? ' (built-in)' : '';
          const label = summarizeSkill(c.entry.spec);
          return (
            <Text key={c.entry.name} color={active ? 'cyanBright' : undefined}>
              {marker} {label}
              {tag}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ select Enter confirm Esc skip q quit</Text>
      </Box>
    </Box>
  );
};

export const SkillPicker = {
  /**
   * Run the picker as a standalone ink app and resolve with the chosen skill
   * name (or undefined if the user skipped). Used by `start.ts` before mounting
   * the main App.
   */
  pickInteractive: async (entries: SkillListEntry[]): Promise<string | undefined> => {
    return new Promise<string | undefined>((resolve) => {
      let resolved = false;
      const onResolve = (name: string | undefined) => {
        if (resolved) return;
        resolved = true;
        resolve(name);
      };
      const app = render(React.createElement(PickerComponent, { entries, onResolve }));
      app.waitUntilExit().then(() => {
        if (!resolved) onResolve(undefined);
      });
    });
  },
};

// Re-export the React component for tests / advanced embedding.
export const SkillPickerComponent = PickerComponent;
