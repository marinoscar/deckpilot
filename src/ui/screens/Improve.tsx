import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { defaultImproveProjectName } from '../../chat/improve.js';
import { summarizeSkill } from '../../skill/spec.js';
import { type SkillListEntry, listSkills } from '../../store/skills.js';
import { type TemplateListEntry, listTemplates } from '../../store/templates.js';
import { summarizeTemplate } from '../../template/spec.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';
import { PptxPickStep } from './PptxPickStep.js';

type Mode =
  | { kind: 'source' }
  | { kind: 'template'; sourcePath: string }
  | { kind: 'skill'; sourcePath: string; templateName: string }
  | { kind: 'name'; sourcePath: string; templateName: string; skillName?: string };

type Props = {
  onStart: (opts: {
    sourcePath: string;
    templateName: string;
    skillName?: string;
    projectName?: string;
  }) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const Improve: React.FC<Props> = ({ onStart, onBack }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'source' });
  const [templates, setTemplates] = useState<TemplateListEntry[] | null>(null);
  const [tplIndex, setTplIndex] = useState(0);
  const [skills, setSkills] = useState<SkillListEntry[] | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);

  useEffect(() => {
    void listTemplates().then(setTemplates);
    void listSkills().then(setSkills);
  }, []);

  if (mode.kind === 'source') {
    return (
      <PptxPickStep
        title="Improve"
        step="step 1 of 4 — pick the SOURCE deck (the deck to improve)"
        onPick={(sourcePath) => setMode({ kind: 'template', sourcePath })}
        onBack={onBack}
      />
    );
  }

  if (mode.kind === 'template') {
    return (
      <TemplatePickStep
        templates={templates}
        tplIndex={tplIndex}
        setTplIndex={setTplIndex}
        onConfirm={(templateName) =>
          setMode({ kind: 'skill', sourcePath: mode.sourcePath, templateName })
        }
        onBack={() => setMode({ kind: 'source' })}
      />
    );
  }

  if (mode.kind === 'skill') {
    return (
      <SkillPickStep
        skills={skills}
        skillIndex={skillIndex}
        setSkillIndex={setSkillIndex}
        onConfirm={(skillName) =>
          setMode({
            kind: 'name',
            sourcePath: mode.sourcePath,
            templateName: mode.templateName,
            skillName,
          })
        }
        onBack={() => setMode({ kind: 'template', sourcePath: mode.sourcePath })}
      />
    );
  }

  const suggested = defaultImproveProjectName(mode.sourcePath);
  return (
    <Panel title="Improve" subtitle="step 4 of 4 — project name" footer="Enter start · Esc back">
      <TextInput
        label="name:"
        hint={`lower-case kebab, or empty for "${suggested}"`}
        validate={(v) => {
          const s = v.trim();
          if (!s) return undefined;
          return SLUG.test(s) ? undefined : 'Use lower-case kebab.';
        }}
        onCancel={() =>
          setMode({
            kind: 'skill',
            sourcePath: mode.sourcePath,
            templateName: mode.templateName,
          })
        }
        onSubmit={(v) => {
          const trimmed = v.trim();
          onStart({
            sourcePath: mode.sourcePath,
            templateName: mode.templateName,
            skillName: mode.skillName,
            projectName: trimmed || undefined,
          });
        }}
      />
    </Panel>
  );
};

/**
 * Pick a saved template. Required in improve mode — there is no "Let the AI
 * choose" row; the improved deck always adopts a deliberate brand look. If no
 * templates exist, the only action is to go back and create one.
 */
const TemplatePickStep: React.FC<{
  templates: TemplateListEntry[] | null;
  tplIndex: number;
  setTplIndex: (n: number) => void;
  onConfirm: (templateName: string) => void;
  onBack: () => void;
}> = ({ templates, tplIndex, setTplIndex, onConfirm, onBack }) => {
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
    <Panel
      title="Improve"
      subtitle="step 2 of 4 — pick a template (required)"
      footer="↑/↓ navigate · Enter next · b/Esc back"
    >
      {templates === null ? (
        <Text dimColor>loading templates …</Text>
      ) : count === 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">No saved templates.</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Improve needs a template for the rebuilt deck. Create one with `deckpilot template
              create &lt;name&gt; --from &lt;deck.pptx&gt;`, then come back.
            </Text>
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

/** Pick an optional skill (index 0 = "No skill"). */
const SkillPickStep: React.FC<{
  skills: SkillListEntry[] | null;
  skillIndex: number;
  setSkillIndex: (n: number) => void;
  onConfirm: (skillName?: string) => void;
  onBack: () => void;
}> = ({ skills, skillIndex, setSkillIndex, onConfirm, onBack }) => {
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
      else onConfirm(skills[skillIndex - 1]?.name);
    }
  });

  return (
    <Panel
      title="Improve"
      subtitle="step 3 of 4 — pick a skill (optional)"
      footer="↑/↓ navigate · Enter next · b/Esc back"
    >
      {skills === null ? (
        <Text dimColor>loading skills …</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color={skillIndex === 0 ? Theme.primary : undefined} bold={skillIndex === 0}>
              {skillIndex === 0 ? '❯ ' : '  '}No skill
            </Text>
            <Text dimColor>{'   (default; no staged instructions)'}</Text>
          </Box>
          {skills.map((e, i) => {
            const active = skillIndex === i + 1;
            const tag = e.builtin ? ' (built-in)' : '';
            return (
              <Box key={e.name}>
                <Text color={active ? Theme.primary : undefined} bold={active}>
                  {active ? '❯ ' : '  '}
                  {summarizeSkill(e.spec)}
                  {tag}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Panel>
  );
};
