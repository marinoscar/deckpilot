import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type FileEntry, filterFiles, humanSize, scanWorkspaceFiles } from '../util/files.js';

type Props = {
  query: string;
  selectedIndex: number;
  onResolve: (filtered: FileEntry[]) => void;
  /** 'default' = `@` picker; 'image' = `/image`; 'document' = `/doc`. */
  mode?: 'default' | 'image' | 'document';
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
 * Popup-style file list. Stateless about input — App routes keypresses to it.
 * Loads cwd once on mount, then filters client-side as `query` changes.
 */
export const FilePicker: React.FC<Props> = ({
  query,
  selectedIndex,
  onResolve,
  mode = 'default',
  selected,
}) => {
  const [all, setAll] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const multi = mode === 'image' || mode === 'document';
  const lead = mode === 'image' ? '🖼' : mode === 'document' ? '📄' : '@';
  const accent = mode === 'image' ? 'yellow' : mode === 'document' ? 'blue' : 'cyan';
  const scanKind = mode === 'image' ? 'images' : mode === 'document' ? 'documents' : 'default';

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

  useEffect(() => {
    onResolve(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, all.length]);

  if (loading) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>{lead} scanning workspace …</Text>
      </Box>
    );
  }

  if (filtered.length === 0) {
    const noun =
      mode === 'image'
        ? 'image files (png/jpg/gif/webp)'
        : mode === 'document'
          ? 'document files (txt/md/pptx/docx)'
          : '.pptx or .plan.json files';
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
        {lead} {filtered.length} {mode === 'image' ? 'image' : mode === 'document' ? 'doc' : 'file'}
        {filtered.length === 1 ? '' : 's'}
        {multi
          ? ` · ${selected?.size ?? 0} selected (↑/↓ · Space toggle · Enter done · Esc cancel)`
          : ' (↑/↓ select · Enter insert · Esc cancel)'}
      </Text>
      {visible.map((f, i) => {
        const realIndex = start + i;
        const sel = realIndex === selectedIndex;
        const checked = multi && selected?.has(f.path);
        return (
          <Box key={f.path}>
            <Text color={sel ? `${accent}Bright` : 'gray'}>{sel ? '› ' : '  '}</Text>
            {multi ? (
              <Text color={checked ? 'green' : 'gray'}>{checked ? '[x] ' : '[ ] '}</Text>
            ) : null}
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
