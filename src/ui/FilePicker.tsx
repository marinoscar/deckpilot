import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { filterFiles, humanSize, scanWorkspaceFiles, type FileEntry } from '../util/files.js';

type Props = {
  query: string;
  selectedIndex: number;
  onResolve: (filtered: FileEntry[]) => void;
};

const KIND_LABEL: Record<FileEntry['kind'], string> = {
  pptx: 'pptx',
  'plan.json': 'plan',
  json: 'json',
  other: 'file',
};

const KIND_COLOR: Record<FileEntry['kind'], string> = {
  pptx: 'magenta',
  'plan.json': 'green',
  json: 'cyan',
  other: 'gray',
};

const MAX_VISIBLE = 8;

/**
 * Popup-style file list. Stateless about input — App routes keypresses to it.
 * Loads cwd once on mount, then filters client-side as `query` changes.
 */
export const FilePicker: React.FC<Props> = ({ query, selectedIndex, onResolve }) => {
  const [all, setAll] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const files = await scanWorkspaceFiles();
      if (cancelled) return;
      setAll(files);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = filterFiles(all, query);

  useEffect(() => {
    onResolve(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, all.length]);

  if (loading) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>@ scanning workspace …</Text>
      </Box>
    );
  }

  if (filtered.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color="yellow">
          @ no matching .pptx or .plan.json files in {process.cwd()} (query: {query || '∅'})
        </Text>
      </Box>
    );
  }

  // Window the visible slice so the selected item stays in view.
  const start = Math.max(0, Math.min(selectedIndex - 3, filtered.length - MAX_VISIBLE));
  const visible = filtered.slice(start, start + MAX_VISIBLE);

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        @ {filtered.length} file{filtered.length === 1 ? '' : 's'} (↑/↓ select · Enter insert · Esc cancel)
      </Text>
      {visible.map((f, i) => {
        const realIndex = start + i;
        const sel = realIndex === selectedIndex;
        return (
          <Box key={f.path}>
            <Text color={sel ? 'cyanBright' : 'gray'}>{sel ? '› ' : '  '}</Text>
            <Text color={sel ? 'white' : KIND_COLOR[f.kind]} bold={sel}>
              [{KIND_LABEL[f.kind]}]
            </Text>
            <Text color={sel ? 'white' : undefined}> {f.path}</Text>
            <Text dimColor> ({humanSize(f.size)})</Text>
          </Box>
        );
      })}
      {filtered.length > visible.length ? (
        <Text dimColor>
          … {filtered.length - visible.length} more (type to filter)
        </Text>
      ) : null}
    </Box>
  );
};
