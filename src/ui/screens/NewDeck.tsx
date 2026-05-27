import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type TemplateListEntry, listTemplates } from '../../store/templates.js';
import { summarizeTemplate } from '../../template/spec.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';

type Mode = { kind: 'name' } | { kind: 'template'; name?: string };

type Props = {
  onStart: (opts: { projectName?: string; templateName?: string }) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const NewDeck: React.FC<Props> = ({ onStart, onBack }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'name' });
  const [templates, setTemplates] = useState<TemplateListEntry[] | null>(null);
  const [tplIndex, setTplIndex] = useState(0);

  useEffect(() => {
    void listTemplates().then(setTemplates);
  }, []);

  if (mode.kind === 'name') {
    return (
      <Panel
        title="New deck"
        subtitle="step 1 of 2 — project name (leave blank to auto-name)"
        footer="Enter next · Esc back"
      >
        <TextInput
          label="name:"
          hint="lower-case kebab, or empty for auto (project-1, project-2, …)"
          validate={(v) => {
            const s = v.trim();
            if (!s) return undefined;
            return SLUG.test(s) ? undefined : 'Use lower-case kebab.';
          }}
          onCancel={onBack}
          onSubmit={(v) => {
            const trimmed = v.trim();
            setMode({ kind: 'template', name: trimmed || undefined });
          }}
        />
      </Panel>
    );
  }

  // template picker
  return (
    <TemplatePickStep
      name={mode.name}
      templates={templates}
      tplIndex={tplIndex}
      setTplIndex={setTplIndex}
      onConfirm={(templateName) => onStart({ projectName: mode.name, templateName })}
      onBack={() => setMode({ kind: 'name' })}
    />
  );
};

const TemplatePickStep: React.FC<{
  name?: string;
  templates: TemplateListEntry[] | null;
  tplIndex: number;
  setTplIndex: (n: number) => void;
  onConfirm: (templateName?: string) => void;
  onBack: () => void;
}> = ({ name, templates, tplIndex, setTplIndex, onConfirm, onBack }) => {
  // Choices: index 0 = "Let the AI choose"; index 1+ = entries
  const choiceCount = (templates?.length ?? 0) + 1;
  const aiChoice = tplIndex === 0;

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (key.upArrow) setTplIndex(Math.max(0, tplIndex - 1));
    else if (key.downArrow) setTplIndex(Math.min(choiceCount - 1, tplIndex + 1));
    else if (key.return) {
      if (aiChoice || !templates) onConfirm(undefined);
      else {
        const t = templates[tplIndex - 1];
        onConfirm(t?.name);
      }
    }
  });

  return (
    <Panel
      title="New deck"
      subtitle={`step 2 of 2 — pick a template${name ? ` (project: ${name})` : ''}`}
      footer="↑/↓ navigate · Enter start · b/Esc back"
    >
      {templates === null ? (
        <Text dimColor>loading templates …</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color={tplIndex === 0 ? 'cyanBright' : undefined} bold={tplIndex === 0}>
              {tplIndex === 0 ? '▸' : ' '} Let the AI choose
            </Text>
            <Text dimColor>{'   (default; no template applied)'}</Text>
          </Box>
          {templates.length === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>
                No saved templates. Press Enter to let the AI invent palette + fonts.
              </Text>
            </Box>
          ) : (
            templates.map((e, i) => {
              const active = tplIndex === i + 1;
              return (
                <Box key={e.name}>
                  <Text color={active ? 'cyanBright' : undefined} bold={active}>
                    {active ? '▸' : ' '} {summarizeTemplate(e.spec)}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
      )}
    </Panel>
  );
};
