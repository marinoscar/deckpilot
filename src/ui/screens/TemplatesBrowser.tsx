import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import {
  type TemplateListEntry,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  templateExists,
} from '../../store/templates.js';
import { templateDir } from '../../store/paths.js';
import { templateFromPptx } from '../../template/from-pptx.js';
import { blankTemplate, summarizeTemplate } from '../../template/spec.js';
import { Confirm } from '../menu/Confirm.js';
import { type MenuItem, MenuList } from '../menu/MenuList.js';
import { Panel } from '../menu/Panel.js';
import { Spinner } from '../menu/Spinner.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';

type Mode =
  | { kind: 'browse' }
  | { kind: 'show'; entry: TemplateListEntry }
  | { kind: 'confirm-delete'; names: string[] }
  | { kind: 'create-choice' }
  | { kind: 'create-name' }
  | { kind: 'create-pptx-name' }
  | { kind: 'create-pptx-path'; name: string };

type Props = {
  onUseAndStart: (entry: TemplateListEntry) => void;
  onBack: () => void;
  /** Optional callback to open the in-TUI template editor on a template. */
  onEdit?: (entry: TemplateListEntry) => void;
  /**
   * Optional callback to open the editor on a brand-new blank scaffold under
   * `name`. When provided, the `n` flow asks for a name then routes here
   * instead of saving a stub immediately.
   */
  onCreateNew?: (name: string) => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const TemplatesBrowser: React.FC<Props> = ({
  onUseAndStart,
  onBack,
  onEdit,
  onCreateNew,
}) => {
  const [entries, setEntries] = useState<TemplateListEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | undefined>();
  const [filter, setFilter] = useState<string>('');
  const [searching, setSearching] = useState<boolean>(false);

  async function refresh(): Promise<void> {
    const list = await listTemplates();
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

  const visible = (entries ?? []).filter((e) => matchesTemplateFilter(e, filter));

  useInput((input, key) => {
    if (mode.kind !== 'browse') return;
    if (!entries) return;

    // --- search mode ---
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
    if (input === 'n' || input === 'N') {
      // v0.16: open the unified create wizard. Step 1 lets the user pick
      // blank vs from-PPTX.
      setMode({ kind: 'create-choice' });
      return;
    }
    if (input === 'i' || input === 'I') {
      // Power-user shortcut: skip step 1, go straight to import-from-PPTX.
      setMode({ kind: 'create-pptx-name' });
      return;
    }
    if (visible.length === 0) return;

    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(visible.length - 1, i + 1));
    else if (key.return) {
      const entry = visible[index];
      if (entry) onUseAndStart(entry);
    } else if (input === 's' || input === 'S') {
      const entry = visible[index];
      if (entry) setMode({ kind: 'show', entry });
    } else if ((input === 'e' || input === 'E') && onEdit) {
      const entry = visible[index];
      if (entry) onEdit(entry);
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
      const names = checked.size > 0 ? [...checked] : visible[index] ? [visible[index]!.name] : [];
      if (names.length > 0) setMode({ kind: 'confirm-delete', names });
    }
  });

  // ---- detail view ----
  if (mode.kind === 'show') {
    return (
      <Panel
        title={`Template · ${mode.entry.name}`}
        subtitle={`DeckPilot › Templates › ${mode.entry.name}`}
        footer="any key to go back"
      >
        <TemplateDetail entry={mode.entry} />
        <DismissOnKey onDismiss={() => setMode({ kind: 'browse' })} />
      </Panel>
    );
  }

  // ---- confirm delete (single or bulk) ----
  if (mode.kind === 'confirm-delete') {
    const names = mode.names;
    const question =
      names.length === 1
        ? `Permanently delete template "${names[0]}"?`
        : `Permanently delete ${names.length} templates? This cannot be undone.`;
    return (
      <Panel
        title={names.length === 1 ? 'Delete template' : `Delete ${names.length} templates`}
        subtitle="DeckPilot › Templates › Delete"
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
                  await deleteTemplate(name);
                } catch (e) {
                  failures.push(`${name}: ${(e as Error).message}`);
                }
              }
              if (failures.length === 0) {
                setStatus(
                  names.length === 1
                    ? `Deleted "${names[0]}".`
                    : `Deleted ${names.length} templates.`,
                );
              } else {
                setStatus(`Some deletes failed: ${failures.join('; ')}`);
              }
              setChecked(new Set());
              await refresh();
            }
            setMode({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- create wizard step 1: blank or from PPTX? ----
  if (mode.kind === 'create-choice') {
    type Choice = 'blank' | 'from-pptx';
    const items: MenuItem<Choice>[] = [
      {
        value: 'blank',
        label: 'Blank scaffold',
        detail: 'Author a template by hand from a default starting point',
        hotkey: 'b',
      },
      {
        value: 'from-pptx',
        label: 'From an existing .pptx',
        detail: "Extract the source's brand master, palette, and layout vocabulary",
        hotkey: 'p',
      },
    ];
    return (
      <Panel
        title="New template"
        subtitle="DeckPilot › Templates › New"
        footer="↑/↓ navigate · Enter select · b/Esc back"
      >
        <MenuList
          items={items}
          twoColumn
          onSelect={(choice) => {
            if (choice === 'blank') setMode({ kind: 'create-name' });
            else setMode({ kind: 'create-pptx-name' });
          }}
          onBack={() => setMode({ kind: 'browse' })}
        />
      </Panel>
    );
  }

  // ---- create from scratch ----
  if (mode.kind === 'create-name') {
    return (
      <Panel
        title="Create template"
        subtitle="DeckPilot › Templates › New"
        footer="Enter create · Esc cancel"
      >
        <TextInput
          label="name:"
          hint="lower-case kebab (letters, digits, hyphens)"
          required
          validate={(v) => {
            const s = v.trim();
            if (!SLUG.test(s)) return 'Use lower-case kebab (e.g. acme-corp).';
            return undefined;
          }}
          onCancel={() => setMode({ kind: 'browse' })}
          onSubmit={async (v) => {
            const name = v.trim();
            if (await templateExists(name)) {
              setStatus(`A template named "${name}" already exists.`);
              setMode({ kind: 'browse' });
              return;
            }
            if (onCreateNew) {
              // Hand off to the parent (which will open the editor on a blank
              // scaffold). The editor saves on submit; we don't save here.
              setMode({ kind: 'browse' });
              onCreateNew(name);
              return;
            }
            try {
              const { rootDir } = await saveTemplate(blankTemplate(name));
              setStatus(`Created "${name}" at ${rootDir}. Press e to edit, or drop assets/.`);
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

  // ---- create from .pptx ----
  if (mode.kind === 'create-pptx-name') {
    return (
      <Panel
        title="Import template from .pptx"
        subtitle="DeckPilot › Templates › Import (1 of 2)"
        footer="Enter next · Esc cancel"
      >
        <TextInput
          label="name:"
          hint="lower-case kebab"
          required
          validate={(v) => (SLUG.test(v.trim()) ? undefined : 'Use lower-case kebab.')}
          onCancel={() => setMode({ kind: 'browse' })}
          onSubmit={async (v) => {
            const name = v.trim();
            if (await templateExists(name)) {
              setStatus(`A template named "${name}" already exists.`);
              setMode({ kind: 'browse' });
              return;
            }
            setMode({ kind: 'create-pptx-path', name });
          }}
        />
      </Panel>
    );
  }

  if (mode.kind === 'create-pptx-path') {
    return (
      <Panel
        title="Import template from .pptx"
        subtitle={`DeckPilot › Templates › Import (2 of 2) — "${mode.name}"`}
        footer="Enter import · Esc cancel"
      >
        <TextInput
          label="path:"
          hint="absolute path or relative to cwd"
          required
          onCancel={() => setMode({ kind: 'browse' })}
          onSubmit={async (v) => {
            try {
              // v0.16: pass templateRootDir so master extraction copies media
              // (logo, background) into <root>/assets/. Same code path as
              // `deckpilot template create --from <pptx> --shallow`.
              const spec = await templateFromPptx(mode.name, v.trim(), {
                templateRootDir: templateDir(mode.name),
              });
              const { rootDir } = await saveTemplate(spec);
              setStatus(`Imported "${mode.name}" at ${rootDir}.`);
            } catch (e) {
              setStatus(`Import failed: ${(e as Error).message}`);
            }
            await refresh();
            setMode({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- main browser ----
  const breadcrumb = 'DeckPilot › Templates';

  if (entries === null) {
    return (
      <Panel title="Templates" subtitle={breadcrumb}>
        <Spinner label="Reading ~/.deckpilot/templates/" />
      </Panel>
    );
  }

  const footer = buildFooter(entries.length, checked.size, !!onEdit, searching, !!filter);

  const subtitleParts = [breadcrumb, `${entries.length} saved`];
  if (filter) subtitleParts.push(`filter: "${filter}" → ${visible.length} match`);

  return (
    <Panel title="Templates" subtitle={subtitleParts.join(' · ')} footer={footer}>
      {entries.length === 0 ? (
        <Text dimColor>
          No templates saved yet under ~/.deckpilot/templates/.{'\n'}
          Press <Text color={Theme.primary}>n</Text> to scaffold a blank one, or{' '}
          <Text color={Theme.primary}>i</Text> to import from an existing .pptx.
        </Text>
      ) : visible.length === 0 ? (
        <Text dimColor>no templates match "{filter}"</Text>
      ) : (
        <Box flexDirection="column">
          {visible.map((e, i) => {
            const active = i === index;
            const isChecked = checked.has(e.name);
            const marker = active ? '▸' : ' ';
            const checkbox = isChecked ? '[✓] ' : '[ ] ';
            return (
              <Box key={e.name} justifyContent="space-between">
                <Text
                  color={active ? Theme.primary : isChecked ? Theme.success : undefined}
                  bold={active}
                >
                  {marker} {checkbox}
                  {summarizeTemplate(e.spec)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
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
              status.toLowerCase().includes('failed') ||
              status.toLowerCase().includes('already exists')
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

function buildFooter(
  count: number,
  checkedCount: number,
  withEdit: boolean,
  searching: boolean,
  hasFilter: boolean,
): string {
  if (searching) return 'type to filter · Enter accept · Esc clear & exit';
  if (count === 0) return 'n new (from scratch) · i import from .pptx · b/Esc back';
  const editPart = withEdit ? ' · e edit' : '';
  const backLabel = hasFilter ? 'Esc clear filter · b back' : 'b/Esc back';
  if (checkedCount > 0) {
    return `↑/↓ · Enter use · Space toggle · d delete (${checkedCount})${editPart} · s show · n new · i import · / search · ${backLabel}`;
  }
  return `↑/↓ · Enter use · Space select · d delete${editPart} · s show · n new · i import · / search · ${backLabel}`;
}

function matchesTemplateFilter(entry: TemplateListEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay =
    `${entry.name} ${entry.spec.brand ?? ''} ${entry.spec.description ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

const TemplateDetail: React.FC<{ entry: TemplateListEntry }> = ({ entry }) => {
  const s = entry.spec;
  const t = s.theme;
  return (
    <Box flexDirection="column">
      {s.brand ? (
        <Text>
          <Text dimColor>brand: </Text>
          {s.brand}
        </Text>
      ) : null}
      {s.description ? (
        <Text>
          <Text dimColor>description: </Text>
          {s.description}
        </Text>
      ) : null}
      <Text>
        <Text dimColor>palette: </Text>
        {`#${t.accent} + #${t.accentAlt}, ink #${t.ink}, paper #${t.paper}`}
      </Text>
      <Text>
        <Text dimColor>fonts: </Text>
        {`${t.fontHeading} / ${t.fontBody}`}
      </Text>
      <Text>
        <Text dimColor>tone · aspect: </Text>
        {`${t.tone} · ${t.aspect}`}
      </Text>
      {s.voiceHints ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>voice hints:</Text>
          <Text>{s.voiceHints}</Text>
        </Box>
      ) : null}
      {s.copyRules ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>copy rules:</Text>
          <Text>{s.copyRules}</Text>
        </Box>
      ) : null}
      {s.guidance ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>guidance:</Text>
          <Text>{s.guidance}</Text>
        </Box>
      ) : null}
    </Box>
  );
};

const DismissOnKey: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  useInput(() => onDismiss());
  return null;
};
