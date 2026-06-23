import { Box, Text, useInput } from 'ink';
import type React from 'react';
import type { TemplateListEntry } from '../../store/templates.js';
import { summarizeTemplate } from '../../template/spec.js';
import { Panel } from '../menu/Panel.js';
import { Theme } from '../theme.js';

/**
 * Pick a saved template. Shared by the Improve and Transform flows — both make
 * a template REQUIRED (there is no "Let the AI choose" row; the rebuilt/restyled
 * deck always adopts a deliberate brand look). If no templates exist, the only
 * action is to go back and create one.
 */
export const TemplatePickStep: React.FC<{
  title: string;
  step: string;
  /** Shown when there are no saved templates, explaining why one is needed. */
  emptyHint: string;
  templates: TemplateListEntry[] | null;
  tplIndex: number;
  setTplIndex: (n: number) => void;
  onConfirm: (templateName: string) => void;
  onBack: () => void;
}> = ({ title, step, emptyHint, templates, tplIndex, setTplIndex, onConfirm, onBack }) => {
  const count = templates?.length ?? 0;

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (count === 0) return;
    if (key.upArrow) setTplIndex(Math.max(0, tplIndex - 1));
    else if (key.downArrow) setTplIndex(Math.min(count - 1, tplIndex + 1));
    else if (key.return) {
      const t = templates?.[tplIndex];
      if (t) onConfirm(t.name);
    }
  });

  return (
    <Panel title={title} subtitle={step} footer="↑/↓ navigate · Enter next · b/Esc back">
      {templates === null ? (
        <Text dimColor>loading templates …</Text>
      ) : count === 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">No saved templates.</Text>
          <Box marginTop={1}>
            <Text dimColor>{emptyHint}</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {templates.map((e, i) => {
            const active = tplIndex === i;
            return (
              <Box key={e.name}>
                <Text color={active ? Theme.primary : undefined} bold={active}>
                  {active ? '❯ ' : '  '}
                  {summarizeTemplate(e.spec)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Panel>
  );
};
