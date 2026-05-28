import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type ProjectListEntry, deleteProject, listProjects } from '../../store/projects.js';
import { Confirm } from '../menu/Confirm.js';
import { Panel } from '../menu/Panel.js';

type Mode =
  | { kind: 'browse' }
  | { kind: 'show'; entry: ProjectListEntry }
  | { kind: 'confirm-delete'; entry: ProjectListEntry };

type Props = {
  onOpen: (entry: ProjectListEntry) => void;
  onBack: () => void;
};

export const ProjectsBrowser: React.FC<Props> = ({ onOpen, onBack }) => {
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    const list = await listProjects();
    setEntries(list);
    if (index >= list.length) setIndex(Math.max(0, list.length - 1));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useInput((input, key) => {
    if (!entries) return;
    if (mode.kind !== 'browse') return;

    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (entries.length === 0) return;

    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(entries.length - 1, i + 1));
    else if (key.return) {
      const entry = entries[index];
      if (entry) onOpen(entry);
    } else if (input === 's' || input === 'S') {
      const entry = entries[index];
      if (entry) setMode({ kind: 'show', entry });
    } else if (input === 'd' || input === 'D') {
      const entry = entries[index];
      if (entry) setMode({ kind: 'confirm-delete', entry });
    }
  });

  // ---- show mode: detail view ----
  if (mode.kind === 'show') {
    return (
      <Panel
        title={`Project · ${mode.entry.name}`}
        subtitle={mode.entry.rootDir}
        footer="any key to go back"
      >
        <DetailView entry={mode.entry} />
        <DismissOnKey onDismiss={() => setMode({ kind: 'browse' })} />
      </Panel>
    );
  }

  // ---- confirm delete ----
  if (mode.kind === 'confirm-delete') {
    return (
      <Panel title="Delete project" subtitle={mode.entry.name} accent="red">
        <Confirm
          question={`Permanently delete "${mode.entry.name}" and all its files?`}
          danger
          onResolve={async (yes) => {
            if (yes) {
              try {
                await deleteProject(mode.entry.name);
                setStatus(`Deleted "${mode.entry.name}".`);
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

  // ---- main browser ----
  if (entries === null) {
    return (
      <Panel title="Projects" subtitle="loading …">
        <Text dimColor>reading ~/.deckpilot/projects/ …</Text>
      </Panel>
    );
  }

  if (entries.length === 0) {
    return (
      <Panel title="Projects" subtitle="nothing saved yet" footer="b/Esc back">
        <Text dimColor>
          No projects saved yet under ~/.deckpilot/projects/.{'\n'}
          From the main menu, pick "Start a new deck" to begin one.
        </Text>
      </Panel>
    );
  }

  return (
    <Panel
      title="Projects"
      subtitle={`${entries.length} saved · most recently updated first`}
      footer="↑/↓ navigate · Enter open · s show · d delete · b/Esc back"
    >
      <Box flexDirection="column">
        {entries.map((e, i) => {
          const active = i === index;
          const marker = active ? '▸' : ' ';
          const date = e.manifest.updatedAt.slice(0, 19).replace('T', ' ');
          const tpl = e.manifest.templateName ? ` · ${e.manifest.templateName}` : '';
          const noSession = e.manifest.sessionId ? '' : ' (no LLM memory yet)';
          return (
            <Box key={e.name} justifyContent="space-between">
              <Box>
                <Text color={active ? 'cyanBright' : undefined} bold={active}>
                  {marker} {e.name}
                </Text>
                {tpl ? <Text color="magenta">{tpl}</Text> : null}
              </Box>
              <Text dimColor>{date + noSession}</Text>
            </Box>
          );
        })}
      </Box>
      {status ? (
        <Box marginTop={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      ) : null}
    </Panel>
  );
};

const DetailView: React.FC<{ entry: ProjectListEntry }> = ({ entry }) => {
  const m = entry.manifest;
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>created: </Text>
        {m.createdAt}
      </Text>
      <Text>
        <Text dimColor>updated: </Text>
        {m.updatedAt}
      </Text>
      <Text>
        <Text dimColor>template: </Text>
        {m.templateName ?? '(none)'}
      </Text>
      <Text>
        <Text dimColor>model: </Text>
        {m.model ?? '(default)'}
      </Text>
      <Text>
        <Text dimColor>session id: </Text>
        {m.sessionId ?? '(none yet)'}
      </Text>
      <Text>
        <Text dimColor>critique cap: </Text>
        {String(m.critiquePassesPerSlide)}
      </Text>
    </Box>
  );
};

const DismissOnKey: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  useInput(() => onDismiss());
  return null;
};
