import { basename } from 'node:path';
import { Box, Text } from 'ink';
import type React from 'react';
import type { TranscriptEntry } from '../chat/session.js';
import { ContextReport } from './ContextReport.js';
import { StreamingMessage } from './StreamingMessage.js';
import { Theme } from './theme.js';

type Props = { entries: TranscriptEntry[] };

/** Friendly, present-tense labels for the deck tools shown in the transcript. */
const TOOL_LABELS: Record<string, string> = {
  propose_deck_brief: 'Proposing the outline',
  write_slide_code: 'Designing a slide',
  preview_slide: 'Previewing a slide',
  render_deck: 'Rendering the deck',
  save_deck: 'Saving the deck',
  inspect_template: 'Inspecting the template',
  list_templates: 'Listing templates',
  use_template: 'Applying the template',
  save_template: 'Saving the template',
  import_template_from_pptx: 'Importing a template',
  load_skill_stage: 'Loading skill guidance',
  study_pptx_slides: 'Studying the source slides',
};

/** Humanize a tool name for display: known label, else de-underscored name. */
function toolLabel(name: string): string {
  if (!name) return 'Working';
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const spaced = name.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const BULLET = '⏺';
const TREE = '⎿';

/**
 * Renders a single transcript entry in the Claude-Code idiom. Used by BOTH the
 * <Static> scrollback region (finalized entries) and the live region (the
 * streaming assistant / in-flight tool), so an entry looks identical the moment
 * it hands off from live → committed — no flicker. The only visual difference
 * is the streaming cursor, which lives inside StreamingMessage.
 */
export const TranscriptEntryView: React.FC<{ entry: TranscriptEntry }> = ({ entry: e }) => {
  switch (e.kind) {
    case 'user':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={Theme.muted}>{'> '}</Text>
            <Text dimColor>{e.text}</Text>
          </Box>
          {e.images?.length ? (
            <Text color="yellow">
              {'  '}🖼 {e.images.map((p) => basename(p)).join(', ')}
            </Text>
          ) : null}
          {e.documents?.length ? (
            <Text color="blue">
              {'  '}📄 {e.documents.map((p) => basename(p)).join(', ')}
            </Text>
          ) : null}
        </Box>
      );
    case 'assistant':
      return <StreamingMessage text={e.text} streaming={e.streaming} />;
    case 'tool': {
      const color = e.status === 'error' ? Theme.error : Theme.primary;
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={color} dimColor={e.status === 'start'}>
              {BULLET}{' '}
            </Text>
            <Text dimColor={e.status === 'start'}>{toolLabel(e.tool)}</Text>
            {e.status === 'start' ? <Text dimColor>{' …'}</Text> : null}
          </Box>
          {e.detail ? (
            <Box marginLeft={2}>
              <Text color={Theme.muted}>{TREE} </Text>
              <Text color={e.status === 'error' ? Theme.error : undefined} dimColor>
                {e.detail}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
    }
    case 'system':
      return (
        <Box marginBottom={1}>
          <Text color={Theme.muted}>{TREE} </Text>
          <Text color="yellow">{e.text}</Text>
        </Box>
      );
    case 'preview':
      return (
        <Box marginBottom={1}>
          <Text color={Theme.primary}>{BULLET} </Text>
          <Text color={Theme.primary}>
            slide {e.slideId} · pass {e.pass} · file://{e.pngPath}
          </Text>
        </Box>
      );
    case 'context':
      return <ContextReport usage={e.usage} model={e.model} />;
  }
};

export const Transcript: React.FC<Props> = ({ entries }) => {
  return (
    <Box flexDirection="column">
      {entries.map((e) => (
        <TranscriptEntryView key={e.id} entry={e} />
      ))}
    </Box>
  );
};
