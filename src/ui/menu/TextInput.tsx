import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useState } from 'react';

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
 * Minimal single-line text input. Backspace works, no cursor movement.
 * Enter submits; Esc cancels. We deliberately avoid pulling in
 * ink-text-input — this gives us full control over key handling and skips a
 * native dep on a small surface.
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
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | undefined>();

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.return) {
      if (required && !value.trim()) {
        setError('Please enter a value.');
        return;
      }
      const err = validate?.(value);
      if (err) {
        setError(err);
        return;
      }
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setError(undefined);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue((v) => v + input);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        {label ? (
          <>
            <Text color="cyanBright">{label}</Text>
            <Text> </Text>
          </>
        ) : null}
        <Text>{value}</Text>
        <Text color="gray">▌</Text>
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
