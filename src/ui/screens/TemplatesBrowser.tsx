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
import { templateFromPptx } from '../../template/from-pptx.js';
import { blankTemplate, summarizeTemplate } from '../../template/spec.js';
import { Confirm } from '../menu/Confirm.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';

type Mode =
  | { kind: 'browse' }
  | { kind: 'show'; entry: TemplateListEntry }
  | { kind: 'confirm-delete'; entry: TemplateListEntry }
  | { kind: 'create-name' }
  | { kind: 'create-pptx-name' }
  | { kind: 'create-pptx-path'; name: string };

type Props = {
  onUseAndStart: (entry: TemplateListEntry) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const TemplatesBrowser: React.FC<Props> = ({ onUseAndStart, onBack }) => {
  const [entries, setEntries] = useState<TemplateListEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    const list = await listTemplates();
    setEntries(list);
    if (index >= list.length) setIndex(Math.max(0, list.length - 1));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useInput((input, key) => {
    if (mode.kind !== 'browse') return;
    if (!entries) return;

    if (key.escape || input === 'b' || input === 'q') {
      onBack();
      return;
    }
    if (input === 'n' || input === 'N') {
      setMode({ kind: 'create-name' });
      return;
    }
    if (input === 'i' || input === 'I') {
      setMode({ kind: 'create-pptx-name' });
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
      if (entry) setMode({ kind: 'confirm-delete', entry });
    }
  });

  // ---- detail view ----
  if (mode.kind === 'show') {
    return (
      <Panel
        title={`Template · ${mode.entry.name}`}
        subtitle={mode.entry.rootDir}
        footer="any key to go back"
      >
        <TemplateDetail entry={mode.entry} />
        <DismissOnKey onDismiss={() => setMode({ kind: 'browse' })} />
      </Panel>
    );
  }

  // ---- confirm delete ----
  if (mode.kind === 'confirm-delete') {
    return (
      <Panel title="Delete template" subtitle={mode.entry.name} accent="red">
        <Confirm
          question={`Permanently delete template "${mode.entry.name}"?`}
          danger
          onResolve={async (yes) => {
            if (yes) {
              try {
                await deleteTemplate(mode.entry.name);
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

  // ---- create from scratch ----
  if (mode.kind === 'create-name') {
    return (
      <Panel
        title="Create template"
        subtitle="from scratch — fill the JSON afterward"
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
            try {
              const { rootDir } = await saveTemplate(blankTemplate(name));
              setStatus(`Created "${name}" at ${rootDir}. Edit template.json + drop assets/.`);
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
        subtitle="step 1 of 2 — template name"
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
        subtitle={`step 2 of 2 — pick the .pptx for "${mode.name}"`}
        footer="Enter import · Esc cancel"
      >
        <TextInput
          label="path:"
          hint="absolute path or relative to cwd"
          required
          onCancel={() => setMode({ kind: 'browse' })}
          onSubmit={async (v) => {
            try {
              const spec = await templateFromPptx(mode.name, v.trim());
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
  if (entries === null) {
    return (
      <Panel title="Templates" subtitle="loading …">
        <Text dimColor>reading ~/.deckpilot/templates/ …</Text>
      </Panel>
    );
  }

  const footer =
    entries.length === 0
      ? 'n new (from scratch) · i import from .pptx · b/Esc back'
      : '↑/↓ navigate · Enter use & start · s show · d delete · n new · i import · b/Esc back';

  return (
    <Panel title="Templates" subtitle={`${entries.length} saved`} footer={footer}>
      {entries.length === 0 ? (
        <Text dimColor>
          No templates saved yet under ~/.deckpilot/templates/.{'\n'}
          Press <Text color="cyanBright">n</Text> to scaffold a blank one, or{' '}
          <Text color="cyanBright">i</Text> to import from an existing .pptx.
        </Text>
      ) : (
        <Box flexDirection="column">
          {entries.map((e, i) => {
            const active = i === index;
            const marker = active ? '▸' : ' ';
            return (
              <Box key={e.name} justifyContent="space-between">
                <Text color={active ? 'cyanBright' : undefined} bold={active}>
                  {marker} {summarizeTemplate(e.spec)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {status ? (
        <Box marginTop={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      ) : null}
    </Panel>
  );
};

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
