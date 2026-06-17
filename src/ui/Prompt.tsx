import { basename } from 'node:path';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlashCommandMeta } from '../chat/slash.js';
import { type FileEntry, pickerLayout, toggleDocument, toggleImage } from '../util/files.js';
import { CaretLine } from './CaretLine.js';
import { FilePicker } from './FilePicker.js';
import { SlashMenu } from './SlashMenu.js';
import {
  type Buffer,
  backspace,
  del,
  empty,
  end,
  home,
  insert,
  left,
  moveVertical,
  right,
} from './text-buffer.js';
import { Theme } from './theme.js';

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
  /** Index of the `@` trigger char in the buffer (the run [start, caret) is the query). */
  start: number;
  query: string;
  index: number;
  mode: 'default' | 'image' | 'document';
  /** Current page in the paged `@` list (default mode only). */
  page: number;
  /** `@` default mode only: the user chose "Type a path…" and is typing a path. */
  manual: boolean;
};

/**
 * Text input + integrated pickers. Behaviour:
 *   - A movable caret: ←/→ move by character, Ctrl+A/Ctrl+E jump to start/end,
 *     ↑/↓ move between rows in a multi-line buffer. Insert/Backspace/Delete all
 *     act at the caret.
 *   - Multi-line: end a line with `\` then Enter (or Shift+Enter where the
 *     terminal supports it) to insert a newline; Enter alone submits. Pasted
 *     text containing newlines is inserted verbatim.
 *   - Typing `@` (at the start or after whitespace) opens the file picker;
 *     Enter inserts the chosen path at the caret (single-select).
 *   - Submitting `/image` (or `/img`) / `/doc` (or `/docs`) opens a multi-select
 *     picker: Space toggles, Enter confirms (stages for the next message), Esc
 *     cancels. Staged files show in a tray above the prompt.
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
  const [buf, setBuf] = useState<Buffer>(empty);
  const [picker, setPicker] = useState<PickerState | null>(null);
  // Paths toggled within the current image/document-picker session.
  const [selected, setSelected] = useState<string[]>([]);
  const filteredRef = useRef<FileEntry[]>([]);
  // Slash-command autocomplete: highlighted row + a one-shot Esc dismissal.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashFilteredRef = useRef<SlashCommandMeta[]>([]);

  // The menu opens on a leading `/` with no whitespace yet (still typing the
  // command name); a space starts argument editing and closes it. Derived from
  // the buffer rather than a trigger char, unlike the `@` picker.
  const slashQuery =
    !disabled && !picker && !slashDismissed && buf.text.startsWith('/') && !/\s/.test(buf.text)
      ? buf.text.slice(1)
      : null;
  const slashOpen = slashQuery !== null;

  // Reset the highlight whenever the filter changes; let a fresh `/` re-open the
  // menu after an Esc dismissal once the buffer leaves slash-command territory.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the query string only.
  useEffect(() => setSlashIndex(0), [slashQuery]);
  useEffect(() => {
    if (!buf.text.startsWith('/')) setSlashDismissed(false);
  }, [buf.text]);

  // Track latest filtered list from the picker so Enter/Space knows the target.
  const handlePickerResolve = useCallback((files: FileEntry[]) => {
    filteredRef.current = files;
    setPicker((p) => {
      if (!p) return p;
      // Default mode is paged: rows = page files + Show-more + Type-a-path, so
      // clamp to the row count. Multi-select modes index files directly.
      const max =
        p.mode === 'default'
          ? pickerLayout(files.length, p.page).count - 1
          : Math.max(0, files.length - 1);
      return p.index > max ? { ...p, index: max } : p;
    });
  }, []);

  const handleSlashResolve = useCallback((cmds: SlashCommandMeta[]) => {
    slashFilteredRef.current = cmds;
  }, []);

  /**
   * Send (or act on) a submitted line. `/image`/`/doc` open their multi-select
   * pickers instead of being sent; everything else goes to `onSubmit`. Shared by
   * the Enter handler and the slash menu's "run a no-arg command now" path.
   */
  function submit(text: string) {
    if (text === '/image' || text === '/img') {
      setBuf(empty());
      setSelected([]);
      setPicker({ start: 0, query: '', index: 0, mode: 'image', page: 0, manual: false });
      return;
    }
    if (text === '/doc' || text === '/docs') {
      setBuf(empty());
      setSelected([]);
      setPicker({ start: 0, query: '', index: 0, mode: 'document', page: 0, manual: false });
      return;
    }
    if (text.length > 0) {
      setBuf(empty());
      onSubmit(text);
    }
  }

  function shouldOpenAtPosition(text: string, idx: number): boolean {
    if (idx === 0) return true;
    const before = text[idx - 1];
    return before === ' ' || before === '\t' || before === '\n';
  }

  /** Replace the `@query` run with `path ` and place the caret after it. */
  function insertPath(path: string) {
    if (!picker) return;
    const before = buf.text.slice(0, picker.start);
    const after = buf.text.slice(buf.caret);
    const insertion = `${path} `;
    setBuf({ text: before + insertion + after, caret: before.length + insertion.length });
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

      // Single-select `@` file picker, paged. The `@query` run lives at
      // [start, caret); rows are [≤5 files] [Show more…] [Type a path…].
      const { pageStart, showMoreIndex, manualIndex, count, pageCount } = pickerLayout(
        filteredRef.current.length,
        picker.page,
      );

      // Remove the `@` and its query run, then close the picker.
      const closeAndDropAt = () => {
        setBuf((b) => ({
          text: b.text.slice(0, picker.start) + b.text.slice(b.caret),
          caret: picker.start,
        }));
        setPicker(null);
      };

      // ---- "Type a path…" sub-mode: the query run is a free-form path ----
      if (picker.manual) {
        if (key.escape) {
          // Back out to the list (Esc again there closes the picker).
          setPicker({ ...picker, manual: false });
          return;
        }
        if (key.return) {
          const path = picker.query.trim();
          if (path) insertPath(path);
          else closeAndDropAt();
          return;
        }
        if (key.backspace || key.delete) {
          if (picker.query.length === 0) {
            closeAndDropAt();
            return;
          }
          setBuf(backspace);
          setPicker({ ...picker, query: picker.query.slice(0, -1) });
          return;
        }
        if (input && !key.ctrl && !key.meta && !key.tab && !key.leftArrow && !key.rightArrow) {
          setBuf((b) => insert(b, input));
          setPicker({ ...picker, query: picker.query + input });
          return;
        }
        return;
      }

      // ---- list mode ----
      if (key.escape) {
        closeAndDropAt();
        return;
      }
      if (key.return) {
        if (picker.index === manualIndex) {
          setPicker({ ...picker, manual: true });
        } else if (picker.index === showMoreIndex) {
          setPicker({ ...picker, page: (picker.page + 1) % pageCount, index: 0 });
        } else {
          const choice = filteredRef.current[pageStart + picker.index];
          if (choice) insertPath(choice.path);
          else closeAndDropAt();
        }
        return;
      }
      if (key.upArrow) {
        setPicker((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
        return;
      }
      if (key.downArrow) {
        setPicker((p) => (p ? { ...p, index: Math.min(count - 1, p.index + 1) } : p));
        return;
      }
      if (key.backspace || key.delete) {
        if (picker.query.length === 0) {
          // Backspacing over the `@` closes the picker.
          closeAndDropAt();
          return;
        }
        setBuf(backspace);
        // A changed filter restarts paging.
        setPicker({ ...picker, query: picker.query.slice(0, -1), index: 0, page: 0 });
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.tab && !key.leftArrow && !key.rightArrow) {
        setBuf((b) => insert(b, input));
        setPicker({ ...picker, query: picker.query + input, index: 0, page: 0 });
        return;
      }
      return;
    }

    // ---- slash-command autocomplete is open ----
    if (slashOpen) {
      const cmds = slashFilteredRef.current;
      if (key.escape) {
        setSlashDismissed(true);
        return;
      }
      if (key.upArrow) {
        setSlashIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSlashIndex((i) => Math.min(Math.max(0, cmds.length - 1), i + 1));
        return;
      }
      // Tab completes the highlighted command name (and a trailing space when it
      // takes arguments); Enter additionally *runs* a no-arg command now. With no
      // match, Enter falls through so an unknown `/cmd` still gets submitted.
      if ((key.tab || key.return) && cmds.length > 0) {
        const cmd = cmds[slashIndex];
        if (cmd) {
          if (cmd.args) {
            const text = `/${cmd.name} `;
            setBuf({ text, caret: text.length });
          } else if (key.return) {
            submit(`/${cmd.name}`);
          } else {
            const text = `/${cmd.name}`;
            setBuf({ text, caret: text.length });
          }
        }
        return;
      }
      // Any other key (typing, backspace, caret) falls through and keeps the
      // query — and therefore the menu — live.
    }

    // ---- picker is closed ----
    if (key.return) {
      // Shift+Enter inserts a newline where the terminal can report it.
      if (key.shift) {
        setBuf((b) => insert(b, '\n'));
        return;
      }
      // Backslash-continuation: a trailing `\` becomes a real newline (works on
      // every terminal, unlike Shift+Enter detection).
      if (buf.text.endsWith('\\')) {
        setBuf((b) => {
          const text = `${b.text.slice(0, -1)}\n`;
          return { text, caret: text.length };
        });
        return;
      }
      submit(buf.text.trim());
      return;
    }
    // Esc with an empty buffer clears any staged attachments.
    if (key.escape) {
      if (buf.text.length === 0) {
        if (pendingImages.length > 0) onClearImages?.();
        if (pendingDocuments.length > 0) onClearDocuments?.();
      }
      return;
    }
    // Caret movement.
    if (key.leftArrow) {
      setBuf(left);
      return;
    }
    if (key.rightArrow) {
      setBuf(right);
      return;
    }
    if (key.upArrow) {
      setBuf((b) => moveVertical(b, -1));
      return;
    }
    if (key.downArrow) {
      setBuf((b) => moveVertical(b, 1));
      return;
    }
    if (key.ctrl && input === 'a') {
      setBuf(home);
      return;
    }
    if (key.ctrl && input === 'e') {
      setBuf(end);
      return;
    }
    if (key.backspace) {
      setBuf(backspace);
      return;
    }
    if (key.delete) {
      setBuf(del);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input === '@' && shouldOpenAtPosition(buf.text, buf.caret)) {
      const start = buf.caret;
      setBuf((b) => insert(b, '@'));
      setPicker({ start, query: '', index: 0, mode: 'default', page: 0, manual: false });
      return;
    }
    // Plain input (including multi-char pastes, which may contain newlines).
    if (input) {
      setBuf((b) => insert(b, input));
    }
  });

  const trayMarginBottom = picker ? 0 : 1;

  return (
    <Box flexDirection="column">
      {pendingImages.length > 0 ? (
        <Box marginBottom={pendingDocuments.length ? 0 : trayMarginBottom}>
          <Text color="yellow">🖼 attached: </Text>
          <Text>{pendingImages.map((p) => basename(p)).join(', ')}</Text>
          <Text dimColor> ({pendingImages.length}) · /image to add · Esc to clear</Text>
        </Box>
      ) : null}
      {pendingDocuments.length > 0 ? (
        <Box marginBottom={trayMarginBottom}>
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
          page={picker.page}
          manual={picker.manual}
          selected={
            picker.mode === 'image' || picker.mode === 'document' ? new Set(selected) : undefined
          }
        />
      ) : null}
      {slashOpen ? (
        <SlashMenu query={slashQuery} selectedIndex={slashIndex} onResolve={handleSlashResolve} />
      ) : null}
      <Box borderStyle="round" borderColor={Theme.primary} paddingX={1}>
        <CaretLine
          text={buf.text}
          caret={disabled ? null : buf.caret}
          lead={disabled ? '… ' : '› '}
          leadColor={Theme.primary}
        />
      </Box>
    </Box>
  );
};
