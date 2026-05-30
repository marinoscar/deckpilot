import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { summarizeSkill } from '../../skill/spec.js';
import { type SkillListEntry, listSkills } from '../../store/skills.js';
import { type TemplateListEntry, listTemplates } from '../../store/templates.js';
import { summarizeTemplate } from '../../template/spec.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';

type Mode =
  | { kind: 'name' }
  | { kind: 'template'; name?: string }
  | { kind: 'skill'; name?: string; templateName?: string };

type Props = {
  onStart: (opts: { projectName?: string; templateName?: string; skillName?: string }) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const NewDeck: React.FC<Props> = ({ onStart, onBack }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'name' });
  const [templates, setTemplates] = useState<TemplateListEntry[] | null>(null);
  const [tplIndex, setTplIndex] = useState(0);
  const [skills, setSkills] = useState<SkillListEntry[] | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);

  useEffect(() => {
    void listTemplates().then(setTemplates);
    void listSkills().then(setSkills);
  }, []);

  if (mode.kind === 'name') {
    return (
      <Panel
        title="New deck"
        subtitle="step 1 of 3 — project name (leave blank to auto-name)"
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

  if (mode.kind === 'template') {
    return (
      <TemplatePickStep
        name={mode.name}
        templates={templates}
        tplIndex={tplIndex}
        setTplIndex={setTplIndex}
        onConfirm={(templateName) => setMode({ kind: 'skill', name: mode.name, templateName })}
        onBack={() => setMode({ kind: 'name' })}
      />
    );
  }

  // skill picker
  return (
    <SkillPickStep
      name={mode.name}
      skills={skills}
      skillIndex={skillIndex}
      setSkillIndex={setSkillIndex}
      onConfirm={(skillName) =>
        onStart({ projectName: mode.name, templateName: mode.templateName, skillName })
      }
      onBack={() => setMode({ kind: 'template', name: mode.name })}
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
      subtitle={`step 2 of 3 — pick a template${name ? ` (project: ${name})` : ''}`}
      footer="↑/↓ navigate · Enter next · b/Esc back"
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

const SkillPickStep: React.FC<{
  name?: string;
  skills: SkillListEntry[] | null;
  skillIndex: number;
  setSkillIndex: (n: number) => void;
  onConfirm: (skillName?: string) => void;
  onBack: () => void;
}> = ({ name, skills, skillIndex, setSkillIndex, onConfirm, onBack }) => {
  // Choices: index 0 = "No skill"; index 1+ = entries
  const choiceCount = (skills?.length ?? 0) + 1;
  const noneChoice = skillIndex === 0;

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (key.upArrow) setSkillIndex(Math.max(0, skillIndex - 1));
    else if (key.downArrow) setSkillIndex(Math.min(choiceCount - 1, skillIndex + 1));
    else if (key.return) {
      if (noneChoice || !skills) onConfirm(undefined);
      else {
        const s = skills[skillIndex - 1];
        onConfirm(s?.name);
      }
    }
  });

  return (
    <Panel
      title="New deck"
      subtitle={`step 3 of 3 — pick a skill${name ? ` (project: ${name})` : ''}`}
      footer="↑/↓ navigate · Enter start · b/Esc back"
    >
      {skills === null ? (
        <Text dimColor>loading skills …</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color={skillIndex === 0 ? 'cyanBright' : undefined} bold={skillIndex === 0}>
              {skillIndex === 0 ? '▸' : ' '} No skill
            </Text>
            <Text dimColor>{'   (default; no staged instructions)'}</Text>
          </Box>
          {skills.length === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>
                No skills yet. Create one with `deckpilot skill create &lt;name&gt;`.
              </Text>
            </Box>
          ) : (
            skills.map((e, i) => {
              const active = skillIndex === i + 1;
              const tag = e.builtin ? ' (built-in)' : '';
              return (
                <Box key={e.name}>
                  <Text color={active ? 'cyanBright' : undefined} bold={active}>
                    {active ? '▸' : ' '} {summarizeSkill(e.spec)}
                    {tag}
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
