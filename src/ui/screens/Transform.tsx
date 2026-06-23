import type React from 'react';
import { useEffect, useState } from 'react';
import { defaultTransformProjectName } from '../../chat/transform.js';
import { type TemplateListEntry, listTemplates } from '../../store/templates.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';
import { PptxPickStep } from './PptxPickStep.js';
import { TemplatePickStep } from './TemplatePickStep.js';

type Mode =
  | { kind: 'deck' }
  | { kind: 'template'; deckPath: string }
  | { kind: 'name'; deckPath: string; templateName: string };

type Props = {
  onStart: (opts: { deckPath: string; templateName: string; projectName?: string }) => void;
  onBack: () => void;
};

const SLUG = /^[a-z0-9-]+$/;

export const Transform: React.FC<Props> = ({ onStart, onBack }) => {
  const [mode, setMode] = useState<Mode>({ kind: 'deck' });
  const [templates, setTemplates] = useState<TemplateListEntry[] | null>(null);
  const [tplIndex, setTplIndex] = useState(0);

  useEffect(() => {
    void listTemplates().then(setTemplates);
  }, []);

  if (mode.kind === 'deck') {
    return (
      <PptxPickStep
        title="Transform"
        step="step 1 of 3 — pick the deck to restyle (its content is reproduced 1:1)"
        onPick={(deckPath) => setMode({ kind: 'template', deckPath })}
        onBack={onBack}
      />
    );
  }

  if (mode.kind === 'template') {
    return (
      <TemplatePickStep
        title="Transform"
        step="step 2 of 3 — pick a template for the new style (required)"
        emptyHint="Transform restyles the deck into a template’s look. Create one with `deckpilot template create <name> --from <deck.pptx>`, then come back."
        templates={templates}
        tplIndex={tplIndex}
        setTplIndex={setTplIndex}
        onConfirm={(templateName) =>
          setMode({ kind: 'name', deckPath: mode.deckPath, templateName })
        }
        onBack={() => setMode({ kind: 'deck' })}
      />
    );
  }

  const suggested = defaultTransformProjectName(mode.deckPath);
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
        onCancel={() => setMode({ kind: 'template', deckPath: mode.deckPath })}
        onSubmit={(v) => {
          const trimmed = v.trim();
          onStart({
            deckPath: mode.deckPath,
            templateName: mode.templateName,
            projectName: trimmed || undefined,
          });
        }}
      />
    </Panel>
  );
};
