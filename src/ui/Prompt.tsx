import { basename } from 'node:path';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { type FileEntry, toggleDocument, toggleImage } from '../util/files.js';
import { FilePicker } from './FilePicker.js';

type Props = {
  disabled: boolean;
  onSubmit: (text: string) => void;
  /** Images staged for the next message (owned by App, shown in the tray). */
  pendingImages?: string[];
  /** Called when the `/image` picker is confirmed, with the chosen paths. */
  onCommitImages?: (paths: string[]) => void;
  /** Clear all staged images. */
  onClearImages?: () => void;
  /** Documents staged for the next message (owned by App, shown in the tray). */
  pendingDocuments?: string[];
  /** Called when the `/doc` picker is confirmed, with the chosen paths. */
  onCommitDocuments?: (paths: string[]) => void;
  /** Clear all staged documents. */
  onClearDocuments?: () => void;
};

type PickerState = {
  start: number;
  query: string;
  index: number;
  mode: 'default' | 'image' | 'document';
};

/**
 * Text input + integrated pickers. Behaviour:
 *   - Plain typing accumulates into the buffer.
 *   - Typing `@` (after whitespace or at the start) opens the file picker;
 *     Enter inserts the chosen path into the buffer (single-select).
 *   - Submitting `/image` (or `/img`) opens a multi-select image picker:
 *     Space toggles, Enter confirms (stages the images for the next message),
 *     Esc cancels. Staged images show in a tray above the prompt and are sent
 *     with the next message.
 *   - The user can keep typing after a picker closes — the buffer is
 *     uninterrupted.
 */
export const Prompt: React.FC<Props> = ({
  disabled,
  onSubmit,
  pendingImages = [],
  onCommitImages,
  onClearImages,
  pendingDocuments = [],
  onCommitDocuments,
  onClearDocuments,
}) => {
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState<PickerState | null>(null);
  // Paths toggled within the current image-picker session (committed on Enter).
  const [selected, setSelected] = useState<string[]>([]);
  const filteredRef = useRef<FileEntry[]>([]);

  // Track latest filtered list from the picker so Enter/Space knows the target.
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
    const before = value.slice(0, picker.start);
    setValue(`${before}${path} `);
    setPicker(null);
  }

  useInput((input, key) => {
    if (disabled) return;

    // ---- picker is open ----
    if (picker) {
      // Multi-select image / document picker (shared logic).
      if (picker.mode === 'image' || picker.mode === 'document') {
        const isDoc = picker.mode === 'document';
        if (key.escape) {
          setSelected([]);
          setPicker(null);
          return;
        }
        if (key.return) {
          if (isDoc) onCommitDocuments?.(selected);
          else onCommitImages?.(selected);
          setSelected([]);
          setPicker(null);
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
        if (input === ' ') {
          const choice = filteredRef.current[picker.index];
          const toggle = isDoc ? toggleDocument : toggleImage;
          if (choice) setSelected((s) => toggle(s, choice.path));
          return;
        }
        if (key.backspace || key.delete) {
          if (picker.query.length === 0) {
            setSelected([]);
            setPicker(null);
            return;
          }
          setPicker({ ...picker, query: picker.query.slice(0, -1), index: 0 });
          return;
        }
        if (input && !key.ctrl && !key.meta && !key.tab && !key.leftArrow && !key.rightArrow) {
          setPicker({ ...picker, query: picker.query + input, index: 0 });
          return;
        }
        return;
      }

      // Single-select `@` file picker.
      if (key.escape) {
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
      // `/image` (or `/img`) opens the multi-select image picker instead of
      // submitting — images are staged for the next message, not sent now.
      if (text === '/image' || text === '/img') {
        setValue('');
        setSelected([]);
        setPicker({ start: 0, query: '', index: 0, mode: 'image' });
        return;
      }
      // `/doc` (or `/docs`) opens the multi-select document picker — extracted
      // text is attached to the next message, not sent now.
      if (text === '/doc' || text === '/docs') {
        setValue('');
        setSelected([]);
        setPicker({ start: 0, query: '', index: 0, mode: 'document' });
        return;
      }
      if (text.length > 0) {
        setValue('');
        onSubmit(text);
      }
      return;
    }
    // Esc with an empty buffer clears any staged attachments.
    if (key.escape) {
      if (value.length === 0) {
        if (pendingImages.length > 0) onClearImages?.();
        if (pendingDocuments.length > 0) onClearDocuments?.();
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input === '@' && shouldOpenAtPosition(value, value.length)) {
      setValue(value + input);
      setPicker({ start: value.length, query: '', index: 0, mode: 'default' });
      return;
    }
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column">
      {pendingImages.length > 0 ? (
        <Box marginBottom={picker || pendingDocuments.length ? 0 : 1}>
          <Text color="yellow">🖼 attached: </Text>
          <Text>{pendingImages.map((p) => basename(p)).join(', ')}</Text>
          <Text dimColor> ({pendingImages.length}) · /image to add · Esc to clear</Text>
        </Box>
      ) : null}
      {pendingDocuments.length > 0 ? (
        <Box marginBottom={picker ? 0 : 1}>
          <Text color="blue">📄 context: </Text>
          <Text>{pendingDocuments.map((p) => basename(p)).join(', ')}</Text>
          <Text dimColor> ({pendingDocuments.length}) · /doc to add · Esc to clear</Text>
        </Box>
      ) : null}
      {picker ? (
        <FilePicker
          query={picker.query}
          selectedIndex={picker.index}
          onResolve={handlePickerResolve}
          mode={picker.mode}
          selected={
            picker.mode === 'image' || picker.mode === 'document' ? new Set(selected) : undefined
          }
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
