import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { defaultTransformProjectName } from '../../chat/transform.js';
import { type FileEntry, humanSize, scanWorkspaceFiles } from '../../util/files.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';

type Mode =
  | { kind: 'original' }
  | { kind: 'target'; originalPath: string }
  | { kind: 'name'; originalPath: string; targetPath: string };

type Props = {
  onStart: (opts: { originalPath: string; targetPath: string; projectName?: string }) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const Transform: React.FC<Props> = ({ onStart, onBack }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'original' });

  if (mode.kind === 'original') {
    return (
      <PptxPickStep
        step="step 1 of 3 — pick the ORIGINAL deck (content to reproduce)"
        onPick={(originalPath) => setMode({ kind: 'target', originalPath })}
        onBack={onBack}
      />
    );
  }

  if (mode.kind === 'target') {
    return (
      <PptxPickStep
        step="step 2 of 3 — pick the TARGET deck (style/brand to adopt)"
        onPick={(targetPath) =>
          setMode({ kind: 'name', originalPath: mode.originalPath, targetPath })
        }
        onBack={() => setMode({ kind: 'original' })}
      />
    );
  }

  const suggested = defaultTransformProjectName(mode.originalPath);
  return (
    <Panel title="Transform" subtitle="step 3 of 3 — project name" footer="Enter start · Esc back">
      <TextInput
        label="name:"
        hint={`lower-case kebab, or empty for "${suggested}"`}
        validate={(v) => {
          const s = v.trim();
          if (!s) return undefined;
          return SLUG.test(s) ? undefined : 'Use lower-case kebab.';
        }}
        onCancel={() => setMode({ kind: 'target', originalPath: mode.originalPath })}
        onSubmit={(v) => {
          const trimmed = v.trim();
          onStart({
            originalPath: mode.originalPath,
            targetPath: mode.targetPath,
            projectName: trimmed || undefined,
          });
        }}
      />
    </Panel>
  );
};

/**
 * Pick a `.pptx` from the workspace, or type a path. Self-contained: scans cwd
 * for `.pptx` files and offers them as a list, with a final "type a path"
 * option that validates existence + extension.
 */
const PptxPickStep: React.FC<{
  step: string;
  onPick: (path: string) => void;
  onBack: () => void;
}> = ({ step, onPick, onBack }) => {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void scanWorkspaceFiles(undefined, { kinds: 'default' }).then((all) => {
      if (cancelled) return;
      setFiles(all.filter((f) => f.kind === 'pptx'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The "type a path" row is the last selectable entry.
  const count = (files?.length ?? 0) + 1;
  const isManualRow = files !== null && index === count - 1;

  useInput(
    (input, key) => {
      if (key.escape || input === 'b') {
        onBack();
        return;
      }
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIndex((i) => Math.min(count - 1, i + 1));
      else if (key.return) {
        if (isManualRow) {
          setManual(true);
        } else if (files?.[index]) {
          onPick(resolve(process.cwd(), files[index]!.path));
        }
      }
    },
    { isActive: !manual },
  );

  if (manual) {
    return (
      <Panel title="Transform" subtitle={step} footer="Enter confirm · Esc back">
        <TextInput
          label="path:"
          hint="path to a .pptx (absolute or relative to the current folder)"
          validate={(v) => {
            const p = resolve(process.cwd(), v.trim());
            if (!v.trim()) return 'Enter a path.';
            if (!existsSync(p)) return 'No file at that path.';
            if (extname(p).toLowerCase() !== '.pptx') return 'Must be a .pptx file.';
            return undefined;
          }}
          onCancel={() => setManual(false)}
          onSubmit={(v) => onPick(resolve(process.cwd(), v.trim()))}
        />
      </Panel>
    );
  }

  return (
    <Panel title="Transform" subtitle={step} footer="↑/↓ navigate · Enter select · b/Esc back">
      {files === null ? (
        <Text dimColor>scanning workspace …</Text>
      ) : (
        <Box flexDirection="column">
          {files.length === 0 ? (
            <Box marginBottom={1}>
              <Text dimColor>No .pptx files in this folder.</Text>
            </Box>
          ) : (
            files.map((f, i) => {
              const active = index === i;
              return (
                <Box key={f.path}>
                  <Text color={active ? Theme.primary : undefined} bold={active}>
                    {active ? '❯ ' : '  '}
                    {f.path}
                  </Text>
                  <Text dimColor>{`  (${humanSize(f.size)})`}</Text>
                </Box>
              );
            })
          )}
          <Box marginTop={files.length ? 1 : 0}>
            <Text color={isManualRow ? Theme.primary : undefined} bold={isManualRow}>
              {isManualRow ? '❯ ' : '  '}
              Type a path…
            </Text>
          </Box>
        </Box>
      )}
    </Panel>
  );
};
