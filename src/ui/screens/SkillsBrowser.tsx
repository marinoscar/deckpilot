import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { STAGE_PHASE, blankSkillMarkdown, summarizeSkill } from '../../skill/spec.js';
import {
  type SkillListEntry,
  deleteSkill,
  listSkills,
  saveSkill,
  skillExists,
} from '../../store/skills.js';
import { Confirm } from '../menu/Confirm.js';
import { Panel } from '../menu/Panel.js';
import { Spinner } from '../menu/Spinner.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';

type Mode =
  | { kind: 'browse' }
  | { kind: 'show'; entry: SkillListEntry }
  | { kind: 'confirm-delete'; name: string }
  | { kind: 'create-name' };

type Props = {
  onUseAndStart: (entry: SkillListEntry) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const SkillsBrowser: React.FC<Props> = ({ onUseAndStart, onBack }) => {
  const [entries, setEntries] = useState<SkillListEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    const list = await listSkills();
    setEntries(list);
    setIndex((i) => Math.max(0, Math.min(i, list.length - 1)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useInput((input, key) => {
    if (mode.kind !== 'browse' || !entries) return;
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (input === 'n' || input === 'N') {
      setMode({ kind: 'create-name' });
      return;
    }
    if (entries.length === 0) return;

    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(entries.length - 1, i + 1));
    else if (key.return) {
      const entry = entries[index];
      if (entry) onUseAndStart(entry);
    } else if (input === 's' || input === 'S') {
      const entry = entries[index];
      if (entry) setMode({ kind: 'show', entry });
    } else if (input === 'd' || input === 'D') {
      const entry = entries[index];
      if (!entry) return;
      if (entry.builtin) {
        setStatus(
          `"${entry.name}" is a built-in and can't be deleted. Copy it with n to customize.`,
        );
        return;
      }
      setMode({ kind: 'confirm-delete', name: entry.name });
    }
  });

  // ---- detail view ----
  if (mode.kind === 'show') {
    return (
      <Panel
        title={`Skill · ${mode.entry.name}`}
        subtitle={`DeckPilot › Skills › ${mode.entry.name}`}
        footer="any key to go back"
      >
        <SkillDetail entry={mode.entry} />
        <DismissOnKey onDismiss={() => setMode({ kind: 'browse' })} />
      </Panel>
    );
  }

  // ---- confirm delete ----
  if (mode.kind === 'confirm-delete') {
    return (
      <Panel title="Delete skill" subtitle="DeckPilot › Skills › Delete" accent="red">
        <Confirm
          question={`Permanently delete skill "${mode.name}"?`}
          danger
          onResolve={async (yes) => {
            if (yes) {
              try {
                await deleteSkill(mode.name);
                setStatus(`Deleted "${mode.name}".`);
              } catch (e) {
                setStatus(`Delete failed: ${(e as Error).message}`);
              }
              await refresh();
            }
            setMode({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- create from scaffold ----
  if (mode.kind === 'create-name') {
    return (
      <Panel
        title="Create skill"
        subtitle="DeckPilot › Skills › New"
        footer="Enter create · Esc cancel"
      >
        <TextInput
          label="name:"
          hint="lower-case kebab (letters, digits, hyphens)"
          required
          validate={(v) =>
            SLUG.test(v.trim()) ? undefined : 'Use lower-case kebab (e.g. exec-review).'
          }
          onCancel={() => setMode({ kind: 'browse' })}
          onSubmit={async (v) => {
            const name = v.trim();
            if (await skillExists(name)) {
              setStatus(`A skill named "${name}" already exists.`);
              setMode({ kind: 'browse' });
              return;
            }
            try {
              const { rootDir } = await saveSkill(name, blankSkillMarkdown(name));
              setStatus(
                `Created "${name}" at ${rootDir}/SKILL.md. Edit it with \`deckpilot skill edit ${name}\`.`,
              );
            } catch (e) {
              setStatus(`Create failed: ${(e as Error).message}`);
            }
            await refresh();
            setMode({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- main browser ----
  const breadcrumb = 'DeckPilot › Skills';

  if (entries === null) {
    return (
      <Panel title="Skills" subtitle={breadcrumb}>
        <Spinner label="Reading skills" />
      </Panel>
    );
  }

  const footer =
    entries.length === 0
      ? 'n new · b/Esc back'
      : '↑/↓ · Enter use · s show · n new · d delete · b/Esc back';

  return (
    <Panel title="Skills" subtitle={`${breadcrumb} · ${entries.length} available`} footer={footer}>
      {entries.length === 0 ? (
        <Text dimColor>
          No skills yet. A skill is a SKILL.md of staged AI instructions{'\n'}
          (intake · per-slide checks · final review). Press <Text color={Theme.primary}>n</Text> to
          scaffold one.
        </Text>
      ) : (
        <Box flexDirection="column">
          {entries.map((e, i) => {
            const active = i === index;
            const marker = active ? '▸' : ' ';
            const tag = e.builtin ? ' (built-in)' : '';
            return (
              <Box key={e.name}>
                <Text color={active ? Theme.primary : undefined} bold={active}>
                  {marker} {summarizeSkill(e.spec)}
                  {tag}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {status ? (
        <Box marginTop={1}>
          <Text
            color={
              status.toLowerCase().includes('failed') ||
              status.toLowerCase().includes('already exists') ||
              status.toLowerCase().includes("can't")
                ? Theme.error
                : Theme.warn
            }
          >
            {status}
          </Text>
        </Box>
      ) : null}
    </Panel>
  );
};

const SkillDetail: React.FC<{ entry: SkillListEntry }> = ({ entry }) => {
  const s = entry.spec;
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>description: </Text>
        {s.description}
      </Text>
      <Text>
        <Text dimColor>version: </Text>
        {s.version}
        {entry.builtin ? ' · built-in (read-only)' : ''}
      </Text>
      {s.stages.map((stage) => (
        <Box key={stage} marginTop={1} flexDirection="column">
          <Text color={Theme.primary} bold>
            ## {stage}
          </Text>
          <Text dimColor>{STAGE_PHASE[stage]}</Text>
          <Text>{s.instructions[stage]}</Text>
        </Box>
      ))}
    </Box>
  );
};

const DismissOnKey: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  useInput(() => onDismiss());
  return null;
};
