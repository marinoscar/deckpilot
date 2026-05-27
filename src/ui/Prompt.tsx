import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { FileEntry } from '../util/files.js';
import { FilePicker } from './FilePicker.js';

type Props = {
  disabled: boolean;
  onSubmit: (text: string) => void;
};

/**
 * Text input + integrated `@` file picker. Behaviour:
 *   - Plain typing accumulates into the buffer.
 *   - Typing `@` (after whitespace or at the start) opens the picker.
 *   - While the picker is open, characters typed extend the query; ↑/↓ move
 *     the selection; Enter inserts the chosen path; Esc dismisses.
 *   - Backspace inside the query trims the query; backspacing through `@`
 *     closes the picker.
 *   - The user can keep typing after the picker closes — the buffer is
 *     uninterrupted.
 */
export const Prompt: React.FC<Props> = ({ disabled, onSubmit }) => {
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState<{ start: number; query: string; index: number } | null>(
    null,
  );
  const filteredRef = useRef<FileEntry[]>([]);

  // Track latest filtered list from the picker so Enter knows what to insert.
  const handlePickerResolve = useCallback((files: FileEntry[]) => {
    filteredRef.current = files;
    // Clamp selected index if it scrolled off the end of the new filtered list.
    setPicker((p) => {
      if (!p) return p;
      const max = Math.max(0, files.length - 1);
      return p.index > max ? { ...p, index: max } : p;
    });
  }, []);

  function shouldOpenAtPosition(buf: string, idx: number): boolean {
    if (idx === 0) return true;
    const before = buf[idx - 1];
    return before === ' ' || before === '\t';
  }

  function insertPath(path: string) {
    if (!picker) return;
    // Replace [picker.start ... end] with the path. (We treat the picker as
    // anchored to the trailing slice — opens at "@" and runs to end of buf.)
    const before = value.slice(0, picker.start);
    setValue(`${before}${path} `);
    setPicker(null);
  }

  useInput((input, key) => {
    if (disabled) return;

    // ---- picker is open ----
    if (picker) {
      if (key.escape) {
        // Drop just the `@<query>` and close.
        setValue(value.slice(0, picker.start));
        setPicker(null);
        return;
      }
      if (key.return) {
        const choice = filteredRef.current[picker.index];
        if (choice) insertPath(choice.path);
        else {
          setValue(value.slice(0, picker.start));
          setPicker(null);
        }
        return;
      }
      if (key.upArrow) {
        setPicker((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
        return;
      }
      if (key.downArrow) {
        const max = Math.max(0, filteredRef.current.length - 1);
        setPicker((p) => (p ? { ...p, index: Math.min(max, p.index + 1) } : p));
        return;
      }
      if (key.backspace || key.delete) {
        if (picker.query.length === 0) {
          // Backspace at the bare `@` closes the picker and erases the `@`.
          setValue(value.slice(0, picker.start));
          setPicker(null);
          return;
        }
        setPicker({ ...picker, query: picker.query.slice(0, -1), index: 0 });
        setValue(value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.tab && !key.leftArrow && !key.rightArrow) {
        setPicker({ ...picker, query: picker.query + input, index: 0 });
        setValue(value + input);
        return;
      }
      return;
    }

    // ---- picker is closed ----
    if (key.return) {
      const text = value.trim();
      if (text.length > 0) {
        setValue('');
        onSubmit(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.escape || key.tab) return;
    if (input === '@' && shouldOpenAtPosition(value, value.length)) {
      setValue(value + input);
      setPicker({ start: value.length, query: '', index: 0 });
      return;
    }
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column">
      {picker ? (
        <FilePicker
          query={picker.query}
          selectedIndex={picker.index}
          onResolve={handlePickerResolve}
        />
      ) : null}
      <Box>
        <Text color="green">{disabled ? '… ' : '› '}</Text>
        <Text>{value}</Text>
        <Text color="gray">{disabled ? '' : '▌'}</Text>
      </Box>
    </Box>
  );
};
