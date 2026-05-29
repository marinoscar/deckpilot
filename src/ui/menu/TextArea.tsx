import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { Theme } from '../theme.js';

type Props = {
  label?: string;
  defaultValue?: string;
  /** Maximum visible lines before scrolling. Defaults to 8. */
  maxLines?: number;
  /** Soft cap on the number of characters. Defaults to 4096. */
  maxChars?: number;
  /** Submitted on Ctrl+S. */
  onSubmit: (value: string) => void;
  /** Cancellation handler — Esc fires this. */
  onCancel?: () => void;
  /** Help text rendered dim below the input. */
  hint?: string;
};

/**
 * Minimal multi-line text input. Enter inserts a newline; Backspace handles
 * in-line + across-line. Ctrl+S submits; Esc cancels. No cursor movement
 * within a line — append/backspace only, like our single-line TextInput.
 *
 * Use this for short-ish free text (voiceHints, copyRules). For >1KB
 * narratives (guidance), prefer opening $EDITOR via `editInExternal()`.
 */
export const TextArea: React.FC<Props> = ({
  label,
  defaultValue = '',
  maxLines = 8,
  maxChars = 4096,
  onSubmit,
  onCancel,
  hint,
}) => {
  const [lines, setLines] = useState<string[]>(() => defaultValue.split('\n'));
  const [error, setError] = useState<string | undefined>();

  function totalChars(ls: string[]): number {
    return ls.reduce((n, l) => n + l.length, 0) + Math.max(0, ls.length - 1);
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.ctrl && (input === 's' || input === 'S')) {
      onSubmit(lines.join('\n'));
      return;
    }
    if (key.return) {
      // Enter inserts a newline.
      setLines((ls) => {
        if (totalChars(ls) >= maxChars) {
          setError(`Max ${maxChars} characters reached.`);
          return ls;
        }
        return [...ls, ''];
      });
      setError(undefined);
      return;
    }
    if (key.backspace || key.delete) {
      setLines((ls) => {
        const next = [...ls];
        const last = next[next.length - 1] ?? '';
        if (last.length > 0) {
          next[next.length - 1] = last.slice(0, -1);
        } else if (next.length > 1) {
          next.pop();
        }
        return next;
      });
      setError(undefined);
      return;
    }
    if (key.tab || key.meta) return;
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setLines((ls) => {
        if (totalChars(ls) >= maxChars) {
          setError(`Max ${maxChars} characters reached.`);
          return ls;
        }
        const next = [...ls];
        next[next.length - 1] = (next[next.length - 1] ?? '') + input;
        return next;
      });
      setError(undefined);
    }
  });

  const visible = lines.slice(Math.max(0, lines.length - maxLines));
  const truncated = lines.length > maxLines;

  return (
    <Box flexDirection="column">
      {label ? <Text color={Theme.primary}>{label}</Text> : null}
      <Box flexDirection="column">
        {truncated ? <Text dimColor>… {lines.length - maxLines} earlier lines</Text> : null}
        {visible.map((ln, i) => {
          const isLast = i === visible.length - 1;
          return (
            <Box key={i}>
              <Text>{ln}</Text>
              {isLast ? <Text color={Theme.muted}>▌</Text> : null}
            </Box>
          );
        })}
      </Box>
      {error ? (
        <Box>
          <Text color={Theme.error}>{error}</Text>
        </Box>
      ) : hint ? (
        <Box>
          <Text dimColor>
            {hint} · {totalChars(lines)}/{maxChars} chars · Ctrl+S save · Esc cancel
          </Text>
        </Box>
      ) : (
        <Box>
          <Text dimColor>
            {totalChars(lines)}/{maxChars} chars · Ctrl+S save · Esc cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};
