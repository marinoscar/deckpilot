import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type ProjectListEntry, deleteProject, listProjects } from '../../store/projects.js';
import { Confirm } from '../menu/Confirm.js';
import { Panel } from '../menu/Panel.js';
import { Spinner } from '../menu/Spinner.js';
import { Theme } from '../theme.js';

type BrowserMode = 'resume' | 'manage';

type ScreenMode =
  | { kind: 'browse' }
  | { kind: 'show'; entry: ProjectListEntry }
  | { kind: 'confirm-delete'; names: string[] };

type Props = {
  onOpen: (entry: ProjectListEntry) => void;
  onBack: () => void;
  /**
   * `resume` — Enter opens, Esc/b back. No destructive keys, no multi-select.
   * `manage` — adds s (show details), Space (toggle check), d (delete checked
   * or highlighted with confirm).
   */
  mode?: BrowserMode;
};

export const ProjectsBrowser: React.FC<Props> = ({ onOpen, onBack, mode = 'manage' }) => {
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [screen, setScreen] = useState<ScreenMode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | undefined>();
  const [filter, setFilter] = useState<string>('');
  const [searching, setSearching] = useState<boolean>(false);

  async function refresh(): Promise<void> {
    const list = await listProjects();
    setEntries(list);
    setIndex((i) => Math.max(0, Math.min(i, list.length - 1)));
    setChecked((prev) => {
      const valid = new Set(list.map((e) => e.name));
      const next = new Set<string>();
      for (const name of prev) if (valid.has(name)) next.add(name);
      return next;
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  const visible: ProjectListEntry[] = (entries ?? []).filter((e) => matchesFilter(e, filter));

  useInput((input, key) => {
    if (!entries) return;
    if (screen.kind !== 'browse') return;

    // --- search-as-you-type mode ---
    if (searching) {
      if (key.escape) {
        setSearching(false);
        setFilter('');
        setIndex(0);
        return;
      }
      if (key.return) {
        setSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
        setIndex(0);
        return;
      }
      if (key.ctrl || key.meta || key.tab) return;
      if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        setFilter((f) => f + input);
        setIndex(0);
      }
      return;
    }

    // --- normal browse mode ---
    if (key.escape) {
      if (filter) {
        setFilter('');
        setIndex(0);
        return;
      }
      onBack();
      return;
    }
    if (input === '/') {
      setSearching(true);
      return;
    }
    if (input === 'b') {
      onBack();
      return;
    }
    if (visible.length === 0) return;

    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(visible.length - 1, i + 1));
    else if (key.return) {
      const entry = visible[index];
      if (entry) onOpen(entry);
    } else if (mode === 'manage') {
      if (input === 's' || input === 'S') {
        const entry = visible[index];
        if (entry) setScreen({ kind: 'show', entry });
      } else if (input === ' ') {
        const entry = visible[index];
        if (!entry) return;
        setChecked((prev) => {
          const next = new Set(prev);
          if (next.has(entry.name)) next.delete(entry.name);
          else next.add(entry.name);
          return next;
        });
      } else if (input === 'd' || input === 'D') {
        const names =
          checked.size > 0 ? [...checked] : visible[index] ? [visible[index]!.name] : [];
        if (names.length > 0) setScreen({ kind: 'confirm-delete', names });
      }
    }
  });

  // ---- show mode: detail view ----
  if (screen.kind === 'show') {
    return (
      <Panel
        title={`Project · ${screen.entry.name}`}
        subtitle={`DeckPilot › Projects › ${screen.entry.name}`}
        footer="any key to go back"
      >
        <DetailView entry={screen.entry} />
        <DismissOnKey onDismiss={() => setScreen({ kind: 'browse' })} />
      </Panel>
    );
  }

  // ---- confirm delete (single or bulk) ----
  if (screen.kind === 'confirm-delete') {
    const names = screen.names;
    const question =
      names.length === 1
        ? `Permanently delete "${names[0]}" and all its files?`
        : `Permanently delete ${names.length} projects? This cannot be undone.`;
    return (
      <Panel
        title={names.length === 1 ? 'Delete project' : `Delete ${names.length} projects`}
        subtitle="DeckPilot › Projects › Delete"
        accent="red"
      >
        {names.length > 1 ? (
          <Box flexDirection="column" marginBottom={1}>
            {names.map((n) => (
              <Text key={n} dimColor>
                {`  · ${n}`}
              </Text>
            ))}
          </Box>
        ) : null}
        <Confirm
          question={question}
          danger
          onResolve={async (yes) => {
            if (yes) {
              const failures: string[] = [];
              for (const name of names) {
                try {
                  await deleteProject(name);
                } catch (e) {
                  failures.push(`${name}: ${(e as Error).message}`);
                }
              }
              if (failures.length === 0) {
                setStatus(
                  names.length === 1
                    ? `Deleted "${names[0]}".`
                    : `Deleted ${names.length} projects.`,
                );
              } else {
                setStatus(`Some deletes failed: ${failures.join('; ')}`);
              }
              setChecked(new Set());
              await refresh();
            }
            setScreen({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- main browser ----
  const breadcrumb = mode === 'resume' ? 'DeckPilot › Resume' : 'DeckPilot › Projects';

  if (entries === null) {
    return (
      <Panel title="Projects" subtitle={breadcrumb}>
        <Spinner label="Reading ~/.deckpilot/projects/" />
      </Panel>
    );
  }

  if (entries.length === 0) {
    return (
      <Panel title="Projects" subtitle={breadcrumb} footer="b/Esc back">
        <Text dimColor>
          No projects saved yet under ~/.deckpilot/projects/.{'\n'}
          From the main menu, pick "Start a new deck" to begin one.
        </Text>
      </Panel>
    );
  }

  const footer = buildFooter(mode, checked.size, searching, !!filter);

  const subtitleParts = [breadcrumb, `${entries.length} saved · newest first`];
  if (filter) subtitleParts.push(`filter: "${filter}" → ${visible.length} match`);

  return (
    <Panel
      title={mode === 'resume' ? 'Resume a deck' : 'Projects'}
      subtitle={subtitleParts.join(' · ')}
      footer={footer}
    >
      <Box flexDirection="column">
        {visible.length === 0 ? (
          <Text dimColor>no projects match "{filter}"</Text>
        ) : (
          visible.map((e, i) => {
            const active = i === index;
            const isChecked = checked.has(e.name);
            const marker = active ? '▸' : ' ';
            const checkbox = mode === 'manage' ? (isChecked ? '[✓] ' : '[ ] ') : '';
            const date = e.manifest.updatedAt.slice(0, 19).replace('T', ' ');
            const tpl = e.manifest.templateName ? ` · ${e.manifest.templateName}` : '';
            const noSession = e.manifest.sessionId ? '' : ' (no LLM memory yet)';
            return (
              <Box key={e.name} justifyContent="space-between">
                <Box>
                  <Text
                    color={active ? Theme.primary : isChecked ? Theme.success : undefined}
                    bold={active}
                  >
                    {marker} {checkbox}
                    {e.name}
                  </Text>
                  {tpl ? <Text color={Theme.template}>{tpl}</Text> : null}
                </Box>
                <Text dimColor>{date + noSession}</Text>
              </Box>
            );
          })
        )}
      </Box>
      {searching ? (
        <Box marginTop={1}>
          <Text color={Theme.primary}>/{filter}</Text>
          <Text color={Theme.muted}>▌</Text>
        </Box>
      ) : null}
      {status ? (
        <Box marginTop={1}>
          <Text
            color={
              status.toLowerCase().startsWith('some deletes failed') ? Theme.error : Theme.warn
            }
          >
            {status}
          </Text>
        </Box>
      ) : null}
    </Panel>
  );
};

function matchesFilter(entry: ProjectListEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = `${entry.name} ${entry.manifest.templateName ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

function buildFooter(
  mode: BrowserMode,
  checkedCount: number,
  searching: boolean,
  hasFilter: boolean,
): string {
  if (searching) {
    return 'type to filter · Enter accept · Esc clear & exit';
  }
  const backLabel = hasFilter ? 'Esc clear filter · b back' : 'b/Esc back';
  if (mode === 'resume') {
    return `↑/↓ navigate · Enter open · / search · ${backLabel}`;
  }
  if (checkedCount > 0) {
    return `↑/↓ navigate · Enter open · Space toggle · d delete (${checkedCount}) · s show · / search · ${backLabel}`;
  }
  return `↑/↓ navigate · Enter open · Space select · d delete · s show · / search · ${backLabel}`;
}

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
