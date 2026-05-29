import { existsSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { findStyleGuidePath } from '../../config/project.js';
import {
  type Config,
  InvalidConfigValueError,
  emptyConfig,
  loadConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from '../../store/config.js';
import { homeRoot, projectsRoot, templatesRoot } from '../../store/paths.js';
import { listTemplates } from '../../store/templates.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';

type Props = {
  onBack: () => void;
};

type EditableKey = 'critique-passes' | 'model' | 'template';

const EDITABLE_KEYS: EditableKey[] = ['critique-passes', 'model', 'template'];

const KEY_LABELS: Record<EditableKey, string> = {
  'critique-passes': 'Critique passes',
  model: 'Default model',
  template: 'Default template',
};

const KEY_HINTS: Record<EditableKey, string> = {
  'critique-passes': 'Visual critique passes per slide (0-5). 0 disables the critique loop.',
  model: 'LLM model id (e.g. claude-sonnet-4.5, gpt-5).',
  template: 'Default named template slug. Press u to clear.',
};

export const Settings: React.FC<Props> = ({ onBack }) => {
  const [styleGuidePath, setStyleGuidePath] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config>(emptyConfig());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<EditableKey | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setStyleGuidePath(findStyleGuidePath());
    (async () => {
      try {
        const next = await loadConfig();
        setCfg(next);
      } catch (e) {
        setLoadError((e as Error).message);
      }
      try {
        const list = await listTemplates();
        setSavedTemplates(list.map((t) => t.name));
      } catch {
        // listTemplates already returns [] when the dir is missing.
      }
      setLoaded(true);
    })();
  }, []);

  useInput(
    (input, key) => {
      if (editing) return;
      if (key.escape || input === 'b') {
        onBack();
        return;
      }
      if (key.upArrow) {
        setIndex((i) => (i - 1 + EDITABLE_KEYS.length) % EDITABLE_KEYS.length);
        setFlash(null);
      } else if (key.downArrow) {
        setIndex((i) => (i + 1) % EDITABLE_KEYS.length);
        setFlash(null);
      } else if (key.return || input === 'e') {
        setEditing(EDITABLE_KEYS[index] ?? null);
        setFlash(null);
      } else if (input === 'u') {
        // Unset the highlighted key
        void unsetHighlighted();
      }
    },
    { isActive: loaded && !editing },
  );

  async function unsetHighlighted() {
    const key = EDITABLE_KEYS[index];
    if (!key) return;
    try {
      const next = unsetConfigValue(cfg, key);
      await saveConfig(next);
      setCfg(next);
      setFlash({ kind: 'ok', text: `Unset ${KEY_LABELS[key]}.` });
    } catch (e) {
      setFlash({ kind: 'err', text: (e as Error).message });
    }
  }

  async function submitEdit(value: string) {
    const key = editing;
    if (!key) return;
    const trimmed = value.trim();
    try {
      let next: Config;
      if (trimmed === '') {
        next = unsetConfigValue(cfg, key);
      } else {
        next = setConfigValue(cfg, key, trimmed);
      }
      await saveConfig(next);
      setCfg(next);
      setEditing(null);
      setFlash({
        kind: 'ok',
        text: trimmed === '' ? `Unset ${KEY_LABELS[key]}.` : `Saved ${KEY_LABELS[key]}.`,
      });
    } catch (e) {
      const msg = e instanceof InvalidConfigValueError ? e.message : (e as Error).message;
      // Don't close the editor on validation failure — let the user fix it.
      setFlash({ kind: 'err', text: msg });
      throw new Error(msg);
    }
  }

  const home = homeRoot();
  const footer = editing
    ? 'Enter save · Esc cancel · (empty value clears the key)'
    : '↑/↓ navigate · Enter/e edit · u unset · b/Esc back';

  return (
    <Panel title="Settings" subtitle="DeckPilot › Settings" footer={footer}>
      <Box flexDirection="column">
        <Section title="Defaults (persisted at ~/.deckpilot/config.json)">
          {loadError ? (
            <Text color="red">Failed to load config: {loadError}</Text>
          ) : !loaded ? (
            <Text dimColor>Loading…</Text>
          ) : (
            EDITABLE_KEYS.map((key, i) => {
              const active = i === index && !editing;
              const value = readDisplayValue(cfg, key);
              const inEdit = editing === key;
              return (
                <Box key={key} flexDirection="column">
                  <Box>
                    <Text color={active ? 'cyanBright' : undefined} bold={active}>
                      {active ? '▸ ' : '  '}
                      {KEY_LABELS[key].padEnd(20)}
                    </Text>
                    {inEdit ? null : (
                      <Text dimColor>{value === undefined ? '(unset)' : value}</Text>
                    )}
                  </Box>
                  {inEdit ? (
                    <Box marginLeft={2}>
                      <TextInput
                        label="="
                        defaultValue={value ?? ''}
                        hint={
                          KEY_HINTS[key] +
                          (key === 'template' && savedTemplates.length > 0
                            ? `  · saved: ${savedTemplates.join(', ')}`
                            : '')
                        }
                        onSubmit={(v) => {
                          submitEdit(v).catch(() => {
                            // submitEdit already surfaced the error via flash;
                            // swallow so we can keep the input open.
                          });
                        }}
                        onCancel={() => {
                          setEditing(null);
                          setFlash(null);
                        }}
                        validate={(v) => {
                          if (v.trim() === '') return undefined;
                          try {
                            setConfigValue(cfg, key, v.trim());
                            return undefined;
                          } catch (e) {
                            return (e as Error).message;
                          }
                        }}
                      />
                    </Box>
                  ) : active ? (
                    <Box marginLeft={2}>
                      <Text dimColor>{KEY_HINTS[key]}</Text>
                    </Box>
                  ) : null}
                </Box>
              );
            })
          )}
          {flash ? (
            <Box marginTop={1}>
              <Text color={flash.kind === 'ok' ? 'green' : 'red'}>{flash.text}</Text>
            </Box>
          ) : null}
        </Section>

        <Box marginTop={1}>
          <Section title="Paths">
            <Row label="home" value={home} />
            <Row label="projects" value={projectsRoot()} />
            <Row label="templates" value={templatesRoot()} />
            <Row label="DECKPILOT.md" value={styleGuidePath ?? '(none in this directory tree)'} />
          </Section>
        </Box>

        <Box marginTop={1}>
          <Section title="Environment">
            <Row label="DECKPILOT_HOME" value={process.env.DECKPILOT_HOME ?? '(unset)'} />
            <Row
              label="COPILOT_GITHUB_TOKEN"
              value={process.env.COPILOT_GITHUB_TOKEN ? '(set)' : '(unset)'}
            />
            <Row label="EDITOR" value={process.env.EDITOR ?? process.env.VISUAL ?? '(unset)'} />
          </Section>
        </Box>

        {!existsSync(home) ? (
          <Box marginTop={1}>
            <Text dimColor>~/.deckpilot/ doesn't exist yet — it's created on first use.</Text>
          </Box>
        ) : null}
      </Box>
    </Panel>
  );
};

function readDisplayValue(cfg: Config, key: EditableKey): string | undefined {
  if (key === 'critique-passes') {
    const v = cfg.defaults.critiquePassesPerSlide;
    return v === undefined ? undefined : String(v);
  }
  if (key === 'model') return cfg.defaults.model;
  return cfg.defaults.template;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box flexDirection="column">
    <Text color="magenta" bold>
      {title}
    </Text>
    <Box flexDirection="column">{children}</Box>
  </Box>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box>
    <Text dimColor>{label.padEnd(22)}</Text>
    <Text>{value}</Text>
  </Box>
);
