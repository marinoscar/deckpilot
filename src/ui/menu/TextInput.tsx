import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { CaretLine } from '../CaretLine.js';
import { type Buffer, backspace, del, end, home, insert, left, right } from '../text-buffer.js';
import { Theme } from '../theme.js';

type Props = {
  /** Inline label shown to the left of the input. */
  label?: string;
  /** Default value pre-populated in the buffer. */
  defaultValue?: string;
  /** Submitted on Enter; empty string is allowed unless `required`. */
  onSubmit: (value: string) => void;
  /** Cancellation handler — Esc fires this with no value. */
  onCancel?: () => void;
  /** Help text rendered dim below the input. */
  hint?: string;
  /** Reject empty submissions; defaults to false (empty is allowed). */
  required?: boolean;
  /** Optional validator. Return undefined for ok, or a message to show. */
  validate?: (value: string) => string | undefined;
};

/**
 * Minimal single-line text input with a movable block caret (←/→, Ctrl+A/E,
 * Backspace/Delete at the caret). Enter submits; Esc cancels. We deliberately
 * avoid pulling in ink-text-input — this gives us full control over key
 * handling and skips a native dep on a small surface. The caret rendering is
 * shared with the chat prompt via CaretLine.
 */
export const TextInput: React.FC<Props> = ({
  label,
  defaultValue = '',
  onSubmit,
  onCancel,
  hint,
  required = false,
  validate,
}) => {
  const [buf, setBuf] = useState<Buffer>(() => ({
    text: defaultValue,
    caret: defaultValue.length,
  }));
  const [error, setError] = useState<string | undefined>();

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.return) {
      if (required && !buf.text.trim()) {
        setError('Please enter a value.');
        return;
      }
      const err = validate?.(buf.text);
      if (err) {
        setError(err);
        return;
      }
      onSubmit(buf.text);
      return;
    }
    if (key.leftArrow) return setBuf(left);
    if (key.rightArrow) return setBuf(right);
    if (key.ctrl && input === 'a') return setBuf(home);
    if (key.ctrl && input === 'e') return setBuf(end);
    if (key.backspace) {
      setBuf(backspace);
      setError(undefined);
      return;
    }
    if (key.delete) {
      setBuf(del);
      setError(undefined);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input && !key.upArrow && !key.downArrow) {
      setBuf((b) => insert(b, input));
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        {label ? (
          <>
            <Text color={Theme.primary}>{label}</Text>
            <Text> </Text>
          </>
        ) : null}
        <CaretLine text={buf.text} caret={buf.caret} />
      </Box>
      {error ? (
        <Box>
          <Text color="red">{error}</Text>
        </Box>
      ) : hint ? (
        <Box>
          <Text dimColor>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
