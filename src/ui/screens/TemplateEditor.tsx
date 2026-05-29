import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useMemo, useState } from 'react';
import { saveTemplate, templateExists } from '../../store/templates.js';
import { type TemplateSpec, TemplateSpecSchema, formatZodError } from '../../template/spec.js';
import { editInExternal } from '../../util/external-editor.js';
import { Confirm } from '../menu/Confirm.js';
import { Panel } from '../menu/Panel.js';
import { Spinner } from '../menu/Spinner.js';
import { TextArea } from '../menu/TextArea.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';

const TONES = [
  'editorial',
  'minimal',
  'corporate',
  'energetic',
  'studious',
  'playful',
  'luxe',
] as const;

const ASPECTS = ['16:9', '4:3'] as const;

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  initial: TemplateSpec;
  onSaved: (spec: TemplateSpec) => void;
  onCancel: () => void;
};

type FieldKey =
  | 'name'
  | 'brand'
  | 'description'
  | 'theme.accent'
  | 'theme.accentAlt'
  | 'theme.ink'
  | 'theme.muted'
  | 'theme.paper'
  | 'theme.fontHeading'
  | 'theme.fontBody'
  | 'theme.tone'
  | 'theme.aspect'
  | 'voiceHints'
  | 'copyRules'
  | 'guidance'
  | 'assets.logo'
  | 'assets.wordmark'
  | 'assets.background';

const FIELDS: { key: FieldKey; label: string; section?: string }[] = [
  { key: 'name', label: 'name', section: 'Identity' },
  { key: 'brand', label: 'brand' },
  { key: 'description', label: 'description' },

  { key: 'theme.accent', label: 'accent (hex)', section: 'Theme' },
  { key: 'theme.accentAlt', label: 'accentAlt (hex)' },
  { key: 'theme.ink', label: 'ink (hex)' },
  { key: 'theme.muted', label: 'muted (hex)' },
  { key: 'theme.paper', label: 'paper (hex)' },
  { key: 'theme.fontHeading', label: 'fontHeading' },
  { key: 'theme.fontBody', label: 'fontBody' },
  { key: 'theme.tone', label: 'tone (toggle)' },
  { key: 'theme.aspect', label: 'aspect (toggle)' },

  { key: 'voiceHints', label: 'voiceHints', section: 'Voice & guidance' },
  { key: 'copyRules', label: 'copyRules' },
  { key: 'guidance', label: 'guidance (long)' },

  { key: 'assets.logo', label: 'assets.logo', section: 'Assets (paths relative to template dir)' },
  { key: 'assets.wordmark', label: 'assets.wordmark' },
  { key: 'assets.background', label: 'assets.background' },
];

const HEX_REGEX = /^[0-9a-fA-F]{6}$/;

type ScreenMode =
  | { kind: 'browse' }
  | { kind: 'edit-string'; key: FieldKey }
  | { kind: 'edit-area'; key: FieldKey; initial: string }
  | { kind: 'edit-external'; key: FieldKey }
  | { kind: 'confirm-cancel' };

export const TemplateEditor: React.FC<Props> = ({ mode, initial, onSaved, onCancel }) => {
  const [spec, setSpec] = useState<TemplateSpec>(initial);
  const [index, setIndex] = useState(mode === 'create' ? 0 : 1); // skip name in edit
  const [screen, setScreen] = useState<ScreenMode>({ kind: 'browse' });
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const activeField = FIELDS[index];

  const currentValue = useMemo(() => readField(spec, activeField?.key), [spec, activeField]);

  useInput(
    (input, key) => {
      if (screen.kind !== 'browse') return;
      if (key.escape) {
        if (dirty) setScreen({ kind: 'confirm-cancel' });
        else onCancel();
        return;
      }
      if (input === 'q') {
        if (dirty) setScreen({ kind: 'confirm-cancel' });
        else onCancel();
        return;
      }
      if (key.upArrow) {
        setIndex((i) => (i - 1 + FIELDS.length) % FIELDS.length);
        setFlash(null);
        return;
      }
      if (key.downArrow) {
        setIndex((i) => (i + 1) % FIELDS.length);
        setFlash(null);
        return;
      }
      if (input === 's' && key.ctrl) {
        void save();
        return;
      }
      if (input === 'S' || (input === 's' && !key.ctrl)) {
        void save();
        return;
      }
      if (!activeField) return;
      if (key.return || input === 'e') {
        openEditor(activeField.key);
        return;
      }
      if (input === 'E') {
        // Force-external for the highlighted field (any field, but most useful
        // for the long-form ones).
        setScreen({ kind: 'edit-external', key: activeField.key });
        void runExternal(activeField.key);
      }
    },
    { isActive: screen.kind === 'browse' && !saving },
  );

  function openEditor(key: FieldKey) {
    if (key === 'theme.tone') {
      cycleTone();
      return;
    }
    if (key === 'theme.aspect') {
      toggleAspect();
      return;
    }
    if (key === 'voiceHints' || key === 'copyRules') {
      setScreen({ kind: 'edit-area', key, initial: (readField(spec, key) as string) ?? '' });
      return;
    }
    if (key === 'guidance') {
      setScreen({ kind: 'edit-external', key });
      void runExternal(key);
      return;
    }
    setScreen({ kind: 'edit-string', key });
  }

  function cycleTone() {
    const current = spec.theme.tone;
    const i = TONES.indexOf(current as (typeof TONES)[number]);
    const next = TONES[(i + 1) % TONES.length];
    setSpec((s) => ({ ...s, theme: { ...s.theme, tone: next } }));
    setDirty(true);
    setFlash({ kind: 'ok', text: `tone → ${next}` });
  }

  function toggleAspect() {
    const next = spec.theme.aspect === '16:9' ? '4:3' : '16:9';
    setSpec((s) => ({ ...s, theme: { ...s.theme, aspect: next } }));
    setDirty(true);
    setFlash({ kind: 'ok', text: `aspect → ${next}` });
  }

  async function runExternal(key: FieldKey) {
    const start = (readField(spec, key) as string) ?? '';
    try {
      const out = await editInExternal({
        initialText: start,
        extension: key === 'guidance' ? '.md' : '.txt',
      });
      const next = writeField(spec, key, out.replace(/\r\n/g, '\n'));
      setSpec(next);
      setDirty(true);
      setFlash({ kind: 'ok', text: `Updated ${key}.` });
    } catch (e) {
      setFlash({ kind: 'err', text: (e as Error).message });
    } finally {
      setScreen({ kind: 'browse' });
    }
  }

  async function save() {
    setSaving(true);
    try {
      if (mode === 'create' && (await templateExists(spec.name))) {
        setFlash({ kind: 'err', text: `A template named "${spec.name}" already exists.` });
        setSaving(false);
        return;
      }
      const parsed = TemplateSpecSchema.safeParse(spec);
      if (!parsed.success) {
        setFlash({ kind: 'err', text: `Validation failed:\n${formatZodError(parsed.error)}` });
        setSaving(false);
        return;
      }
      await saveTemplate(parsed.data, { overwrite: mode === 'edit' });
      setDirty(false);
      setFlash({ kind: 'ok', text: `Saved "${spec.name}".` });
      onSaved(parsed.data);
    } catch (e) {
      setFlash({ kind: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // ---- string editor overlay ----
  if (screen.kind === 'edit-string') {
    const key = screen.key;
    const isHex =
      key.startsWith('theme.') && key !== 'theme.fontHeading' && key !== 'theme.fontBody';
    const isName = key === 'name';
    const initialText = (readField(spec, key) as string) ?? '';
    return (
      <Panel
        title={`Edit ${key}`}
        subtitle="DeckPilot › Templates › Edit › Field"
        footer="Enter save · Esc cancel"
      >
        <TextInput
          label="="
          defaultValue={initialText}
          required={isName}
          hint={
            isHex
              ? 'Six hex digits without #, e.g. 1A2B5E.'
              : isName
                ? 'lower-case kebab (immutable after create).'
                : undefined
          }
          validate={(v) => {
            const val = v.trim();
            if (isHex) {
              if (val !== '' && !HEX_REGEX.test(val)) return 'Six hex digits without #.';
            }
            if (isName && !/^[a-z0-9-]+$/.test(val)) return 'lower-case kebab only.';
            return undefined;
          }}
          onCancel={() => setScreen({ kind: 'browse' })}
          onSubmit={(v) => {
            const next = writeField(spec, key, v.trim() === '' ? undefined : v.trim());
            setSpec(next);
            setDirty(true);
            setScreen({ kind: 'browse' });
            setFlash({ kind: 'ok', text: `Updated ${key}.` });
          }}
        />
      </Panel>
    );
  }

  if (screen.kind === 'edit-area') {
    const key = screen.key;
    return (
      <Panel
        title={`Edit ${key}`}
        subtitle="DeckPilot › Templates › Edit › Field"
        footer="Ctrl+S save · Esc cancel · Enter newline"
      >
        <TextArea
          defaultValue={screen.initial}
          maxChars={key === 'voiceHints' ? 1024 : 2048}
          hint={
            key === 'voiceHints'
              ? 'Voice nudges (1-3 sentences).'
              : 'Copy rules (bullet list of must/never).'
          }
          onCancel={() => setScreen({ kind: 'browse' })}
          onSubmit={(v) => {
            const next = writeField(spec, key, v === '' ? undefined : v);
            setSpec(next);
            setDirty(true);
            setScreen({ kind: 'browse' });
            setFlash({ kind: 'ok', text: `Updated ${key}.` });
          }}
        />
      </Panel>
    );
  }

  if (screen.kind === 'edit-external') {
    return (
      <Panel title="External editor" subtitle="DeckPilot › Templates › Edit › $EDITOR">
        <Spinner label="Waiting for editor to close" />
      </Panel>
    );
  }

  if (screen.kind === 'confirm-cancel') {
    return (
      <Panel title="Discard changes?" subtitle="DeckPilot › Templates › Edit" accent={Theme.error}>
        <Confirm
          question="You have unsaved changes. Discard them?"
          danger
          onResolve={(yes) => {
            if (yes) onCancel();
            else setScreen({ kind: 'browse' });
          }}
        />
      </Panel>
    );
  }

  // ---- main form ----
  const title = mode === 'create' ? 'New template' : `Edit "${spec.name}"`;
  const breadcrumb =
    mode === 'create'
      ? 'DeckPilot › Templates › New'
      : `DeckPilot › Templates › Edit › ${spec.name}`;

  return (
    <Panel
      title={title}
      subtitle={`${breadcrumb}${dirty ? ' · unsaved' : ''}`}
      footer={
        saving
          ? 'saving…'
          : '↑/↓ navigate · Enter/e edit · E force external · s save · q/Esc cancel'
      }
    >
      <Box flexDirection="column">
        {FIELDS.map((field, i) => {
          const active = i === index;
          const isNameInEditMode = field.key === 'name' && mode === 'edit';
          const value = readField(spec, field.key);
          const display = formatValue(field.key, value);
          return (
            <Box key={field.key} flexDirection="column">
              {field.section ? (
                <Box marginTop={i === 0 ? 0 : 1}>
                  <Text color={Theme.accent} bold>
                    {field.section}
                  </Text>
                </Box>
              ) : null}
              <Box>
                <Text color={active ? Theme.primary : undefined} bold={active}>
                  {active ? '▸ ' : '  '}
                  {field.label.padEnd(20)}
                </Text>
                {field.key.startsWith('theme.') &&
                field.key !== 'theme.tone' &&
                field.key !== 'theme.aspect' &&
                field.key !== 'theme.fontHeading' &&
                field.key !== 'theme.fontBody' &&
                typeof value === 'string' &&
                value.length > 0 ? (
                  <Text color={`#${value as string}`}>{display}</Text>
                ) : (
                  <Text dimColor={!value}>{display}</Text>
                )}
                {isNameInEditMode ? <Text dimColor>{'  (immutable)'}</Text> : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      {flash ? (
        <Box marginTop={1}>
          <Text color={flash.kind === 'ok' ? Theme.success : Theme.error}>{flash.text}</Text>
        </Box>
      ) : null}

      {saving ? (
        <Box marginTop={1}>
          <Spinner label="Saving template" />
        </Box>
      ) : null}
    </Panel>
  );
};

function readField(spec: TemplateSpec, key: FieldKey | undefined): unknown {
  if (!key) return undefined;
  if (key === 'name') return spec.name;
  if (key === 'brand') return spec.brand;
  if (key === 'description') return spec.description;
  if (key === 'voiceHints') return spec.voiceHints;
  if (key === 'copyRules') return spec.copyRules;
  if (key === 'guidance') return spec.guidance;
  if (key.startsWith('theme.')) {
    const tk = key.slice('theme.'.length) as keyof typeof spec.theme;
    return spec.theme[tk];
  }
  if (key.startsWith('assets.')) {
    const ak = key.slice('assets.'.length) as keyof NonNullable<typeof spec.assets>;
    return spec.assets?.[ak];
  }
  return undefined;
}

function writeField(spec: TemplateSpec, key: FieldKey, value: unknown): TemplateSpec {
  if (key === 'name') return { ...spec, name: String(value ?? '') };
  if (key === 'brand') return { ...spec, brand: value as string | undefined };
  if (key === 'description') return { ...spec, description: value as string | undefined };
  if (key === 'voiceHints') return { ...spec, voiceHints: value as string | undefined };
  if (key === 'copyRules') return { ...spec, copyRules: value as string | undefined };
  if (key === 'guidance') return { ...spec, guidance: value as string | undefined };
  if (key.startsWith('theme.')) {
    const tk = key.slice('theme.'.length) as keyof typeof spec.theme;
    return { ...spec, theme: { ...spec.theme, [tk]: value as never } };
  }
  if (key.startsWith('assets.')) {
    const ak = key.slice('assets.'.length) as keyof NonNullable<typeof spec.assets>;
    const nextAssets = { ...(spec.assets ?? {}) };
    if (value === undefined || value === '') delete nextAssets[ak];
    else nextAssets[ak] = String(value);
    const hasAny = Object.values(nextAssets).some((v) => v !== undefined && v !== '');
    return { ...spec, assets: hasAny ? nextAssets : undefined };
  }
  return spec;
}

function formatValue(key: FieldKey, value: unknown): string {
  if (value === undefined || value === null || value === '') return '(unset)';
  if (typeof value === 'string') {
    if (key === 'voiceHints' || key === 'copyRules' || key === 'guidance') {
      const oneLine = value.replace(/\s+/g, ' ').trim();
      return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
    }
    if (
      key.startsWith('theme.') &&
      key !== 'theme.tone' &&
      key !== 'theme.aspect' &&
      key !== 'theme.fontHeading' &&
      key !== 'theme.fontBody'
    ) {
      return `#${value}`;
    }
    return value;
  }
  return String(value);
}
