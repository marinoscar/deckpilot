import { Box, Text } from 'ink';
import type React from 'react';
import { caretRowCol } from './text-buffer.js';

type Props = {
  /** The full buffer text (may contain `\n`). */
  text: string;
  /** Flat caret index, or null to render without a cursor (e.g. disabled). */
  caret: number | null;
  /** Lead shown before the first line (e.g. `› `). Continuations are indented to match. */
  lead?: React.ReactNode;
  /** Lead color (defaults to inherit). */
  leadColor?: string;
};

/** A single line with a solid block caret drawn via inverse video at `col`. */
function Line({ text, col }: { text: string; col: number | null }) {
  if (col === null) return <Text>{text || ' '}</Text>;
  const before = text.slice(0, col);
  const under = col < text.length ? text[col] : ' ';
  const after = col < text.length ? text.slice(col + 1) : '';
  return (
    <Text>
      {before}
      <Text inverse>{under}</Text>
      {after}
    </Text>
  );
}

/**
 * Renders an editable buffer with a block caret. Multi-line aware: the caret is
 * drawn on whichever row it falls on; other rows render plainly. The cursor is
 * an inverse-video block (like a real terminal caret) rather than a trailing
 * glyph, so it sits *on* a character and is visible at end-of-line too.
 */
export const CaretLine: React.FC<Props> = ({ text, caret, lead, leadColor }) => {
  const lines = text.split('\n');
  const pos = caret === null ? null : caretRowCol(text, caret);
  // Indent continuation lines to align under the first line's content.
  const indent = typeof lead === 'string' ? ' '.repeat((lead as string).length) : lead ? '  ' : '';
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable per render
        <Box key={i}>
          {i === 0 ? (
            leadColor ? (
              <Text color={leadColor}>{lead}</Text>
            ) : (
              <Text>{lead}</Text>
            )
          ) : (
            <Text>{indent}</Text>
          )}
          <Line text={ln} col={pos && pos.row === i ? pos.col : null} />
        </Box>
      ))}
    </Box>
  );
};
