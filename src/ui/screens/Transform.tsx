import type React from 'react';
import { useState } from 'react';
import { defaultTransformProjectName } from '../../chat/transform.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';
import { PptxPickStep } from './PptxPickStep.js';

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
        title="Transform"
        step="step 1 of 3 — pick the ORIGINAL deck (content to reproduce)"
        onPick={(originalPath) => setMode({ kind: 'target', originalPath })}
        onBack={onBack}
      />
    );
  }

  if (mode.kind === 'target') {
    return (
      <PptxPickStep
        title="Transform"
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
