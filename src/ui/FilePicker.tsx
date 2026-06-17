import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import {
  type FileEntry,
  filterFiles,
  humanSize,
  pickerLayout,
  scanWorkspaceFiles,
} from '../util/files.js';

type Props = {
  query: string;
  selectedIndex: number;
  onResolve: (filtered: FileEntry[]) => void;
  /** 'default' = `@` picker; 'image' = `/image`; 'document' = `/doc`. */
  mode?: 'default' | 'image' | 'document';
  /** Default (`@`) mode is paged — the current page index. */
  page?: number;
  /** Default (`@`) mode: the user chose "Type a path…" and is typing a path. */
  manual?: boolean;
  /** In a multi-select mode, the set of already-staged paths (renders [x] markers). */
  selected?: Set<string>;
};

const KIND_LABEL: Record<FileEntry['kind'], string> = {
  pptx: 'pptx',
  'plan.json': 'plan',
  json: 'json',
  image: 'img',
  document: 'doc',
  other: 'file',
};

const KIND_COLOR: Record<FileEntry['kind'], string> = {
  pptx: 'magenta',
  'plan.json': 'green',
  json: 'cyan',
  image: 'yellow',
  document: 'blue',
  other: 'gray',
};

const MAX_VISIBLE = 8;

/**
 * Popup-style file list. Stateless about input — the prompt routes keypresses
 * to it. Loads cwd once on mount, then filters client-side as `query` changes.
 *
 * The `@` (default) mode lists *every* workspace file newest-first and is
 * **paged** — `PICKER_PAGE_SIZE` rows, a "Show more…" row that cycles pages, and
 * a trailing "Type a path…" row for files outside the folder. The `/image` and
 * `/doc` multi-select modes keep the simple windowed list.
 */
export const FilePicker: React.FC<Props> = ({
  query,
  selectedIndex,
  onResolve,
  mode = 'default',
  page = 0,
  manual = false,
  selected,
}) => {
  const [all, setAll] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const lead = mode === 'image' ? '🖼' : mode === 'document' ? '📄' : '@';
  const accent = mode === 'image' ? 'yellow' : mode === 'document' ? 'blue' : 'cyan';
  const scanKind = mode === 'image' ? 'images' : mode === 'document' ? 'documents' : 'all';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const files = await scanWorkspaceFiles(undefined, { kinds: scanKind });
      if (cancelled) return;
      setAll(files);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scanKind]);

  const filtered = filterFiles(all, query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: report on query/scan changes only.
  useEffect(() => {
    onResolve(filtered);
  }, [query, all.length]);

  // ---- "Type a path…" entry (default mode) ----
  if (mode === 'default' && manual) {
    return (
      <Box
        flexDirection="column"
        marginBottom={1}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
      >
        <Text color={accent} bold>
          ✎ type a path to any file
        </Text>
        <Text>{query ? query : <Text dimColor>(absolute or relative — Tab not needed)</Text>}</Text>
        <Text dimColor>Enter insert · Esc back to the list</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>{lead} scanning workspace …</Text>
      </Box>
    );
  }

  // ---- paged `@` list (default mode): files + Show more… + Type a path… ----
  if (mode === 'default') {
    const { pageStart, pageLen, hasMore, showMoreIndex, manualIndex, pageCount } = pickerLayout(
      filtered.length,
      page,
    );
    const pageFiles = filtered.slice(pageStart, pageStart + pageLen);
    return (
      <Box
        flexDirection="column"
        marginBottom={1}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
      >
        <Text color={accent} bold>
          {lead}{' '}
          {filtered.length === 0
            ? `no files match "${query}"`
            : `newest first — ${pageStart + 1}–${pageStart + pageLen} of ${filtered.length}`}
          <Text dimColor> (↑/↓ select · Enter insert · Esc cancel)</Text>
        </Text>
        {pageFiles.map((f, i) => {
          const sel = selectedIndex === i;
          return (
            <Box key={f.path}>
              <Text color={sel ? `${accent}Bright` : 'gray'}>{sel ? '› ' : '  '}</Text>
              <Text color={sel ? 'white' : KIND_COLOR[f.kind]} bold={sel}>
                [{KIND_LABEL[f.kind]}]
              </Text>
              <Text color={sel ? 'white' : undefined}> {f.path}</Text>
              <Text dimColor> ({humanSize(f.size)})</Text>
            </Box>
          );
        })}
        {hasMore ? (
          <Box>
            <Text
              color={selectedIndex === showMoreIndex ? `${accent}Bright` : 'gray'}
              bold={selectedIndex === showMoreIndex}
            >
              {selectedIndex === showMoreIndex ? '› ' : '  '}Show more…
            </Text>
            <Text dimColor>{`   (page ${page + 1}/${pageCount})`}</Text>
          </Box>
        ) : null}
        <Box>
          <Text
            color={selectedIndex === manualIndex ? `${accent}Bright` : 'gray'}
            bold={selectedIndex === manualIndex}
          >
            {selectedIndex === manualIndex ? '› ' : '  '}Type a path…
          </Text>
        </Box>
      </Box>
    );
  }

  // ---- multi-select (`/image`, `/doc`) windowed list ----
  if (filtered.length === 0) {
    const noun =
      mode === 'image' ? 'image files (png/jpg/gif/webp)' : 'document files (txt/md/pptx/docx)';
    return (
      <Box marginBottom={1}>
        <Text color="yellow">
          {lead} no matching {noun} in {process.cwd()} (query: {query || '∅'})
        </Text>
      </Box>
    );
  }

  // Window the visible slice so the selected item stays in view.
  const start = Math.max(0, Math.min(selectedIndex - 3, filtered.length - MAX_VISIBLE));
  const visible = filtered.slice(start, start + MAX_VISIBLE);

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor={accent}
      paddingX={1}
    >
      <Text color={accent} bold>
        {lead} {filtered.length} {mode === 'image' ? 'image' : 'doc'}
        {filtered.length === 1 ? '' : 's'}
        {` · ${selected?.size ?? 0} selected (↑/↓ · Space toggle · Enter done · Esc cancel)`}
      </Text>
      {visible.map((f, i) => {
        const realIndex = start + i;
        const sel = realIndex === selectedIndex;
        const checked = selected?.has(f.path);
        return (
          <Box key={f.path}>
            <Text color={sel ? `${accent}Bright` : 'gray'}>{sel ? '› ' : '  '}</Text>
            <Text color={checked ? 'green' : 'gray'}>{checked ? '[x] ' : '[ ] '}</Text>
            <Text color={sel ? 'white' : KIND_COLOR[f.kind]} bold={sel}>
              [{KIND_LABEL[f.kind]}]
            </Text>
            <Text color={sel ? 'white' : undefined}> {f.path}</Text>
            <Text dimColor> ({humanSize(f.size)})</Text>
          </Box>
        );
      })}
      {filtered.length > visible.length ? (
        <Text dimColor>… {filtered.length - visible.length} more (type to filter)</Text>
      ) : null}
    </Box>
  );
};
