import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type FileEntry, humanSize, scanWorkspaceFiles } from '../../util/files.js';
import { Panel } from '../menu/Panel.js';
import { TextInput } from '../menu/TextInput.js';
import { Theme } from '../theme.js';

/** How many workspace files to show per page before "Show more". */
const PAGE_SIZE = 5;

/**
 * Pick a `.pptx` from the workspace, or type a path. Shared by the Transform
 * and Improve flows (the only difference is the panel `title`).
 *
 * The workspace list is sorted newest-first (by `scanWorkspaceFiles`) and shown
 * `PAGE_SIZE` at a time. When there are more files than fit on a page, a
 * "Show more" row advances to the next page (replacing the current 5, wrapping
 * back to the first page after the last). A final "Type a path…" row always
 * sits at the end and accepts a free-form path.
 */
export const PptxPickStep: React.FC<{
  title: string;
  step: string;
  onPick: (path: string) => void;
  onBack: () => void;
}> = ({ title, step, onPick, onBack }) => {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [page, setPage] = useState(0);
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void scanWorkspaceFiles(undefined, { kinds: 'default' }).then((all) => {
      if (cancelled) return;
      setFiles(all.filter((f) => f.kind === 'pptx'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = files?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageFiles = files ? files.slice(pageStart, pageStart + PAGE_SIZE) : [];
  const hasMore = total > PAGE_SIZE;

  // Row layout: [page files…] [Show more (if hasMore)] [Type a path…].
  const showMoreIndex = hasMore ? pageFiles.length : -1;
  const manualIndex = pageFiles.length + (hasMore ? 1 : 0);
  const count = manualIndex + 1;
  const isManualRow = files !== null && index === manualIndex;
  const isShowMoreRow = hasMore && index === showMoreIndex;

  useInput(
    (input, key) => {
      if (key.escape || input === 'b') {
        onBack();
        return;
      }
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIndex((i) => Math.min(count - 1, i + 1));
      else if (key.return) {
        if (isShowMoreRow) {
          // Advance a page, wrapping to the first after the last, and put the
          // cursor back on the first file of the freshly-loaded page.
          setPage((p) => (p + 1) % pageCount);
          setIndex(0);
        } else if (isManualRow) {
          setManual(true);
        } else if (pageFiles[index]) {
          onPick(resolve(process.cwd(), pageFiles[index]!.path));
        }
      }
    },
    { isActive: !manual },
  );

  if (manual) {
    return (
      <Panel title={title} subtitle={step} footer="Enter confirm · Esc back">
        <TextInput
          label="path:"
          hint="path to a .pptx (absolute or relative to the current folder)"
          validate={(v) => {
            const p = resolve(process.cwd(), v.trim());
            if (!v.trim()) return 'Enter a path.';
            if (!existsSync(p)) return 'No file at that path.';
            if (extname(p).toLowerCase() !== '.pptx') return 'Must be a .pptx file.';
            return undefined;
          }}
          onCancel={() => setManual(false)}
          onSubmit={(v) => onPick(resolve(process.cwd(), v.trim()))}
        />
      </Panel>
    );
  }

  return (
    <Panel title={title} subtitle={step} footer="↑/↓ navigate · Enter select · b/Esc back">
      {files === null ? (
        <Text dimColor>scanning workspace …</Text>
      ) : (
        <Box flexDirection="column">
          {total === 0 ? (
            <Box marginBottom={1}>
              <Text dimColor>No .pptx files in this folder.</Text>
            </Box>
          ) : (
            <>
              <Box marginBottom={1}>
                <Text dimColor>
                  {`newest first — showing ${pageStart + 1}–${pageStart + pageFiles.length} of ${total}`}
                </Text>
              </Box>
              {pageFiles.map((f, i) => {
                const active = index === i;
                return (
                  <Box key={f.path}>
                    <Text color={active ? Theme.primary : undefined} bold={active}>
                      {active ? '❯ ' : '  '}
                      {f.path}
                    </Text>
                    <Text dimColor>{`  (${humanSize(f.size)})`}</Text>
                  </Box>
                );
              })}
            </>
          )}
          {hasMore ? (
            <Box>
              <Text color={isShowMoreRow ? Theme.primary : undefined} bold={isShowMoreRow}>
                {isShowMoreRow ? '❯ ' : '  '}
                Show more…
              </Text>
              <Text dimColor>{`   (page ${page + 1}/${pageCount})`}</Text>
            </Box>
          ) : null}
          <Box marginTop={total ? 1 : 0}>
            <Text color={isManualRow ? Theme.primary : undefined} bold={isManualRow}>
              {isManualRow ? '❯ ' : '  '}
              Type a path…
            </Text>
          </Box>
        </Box>
      )}
    </Panel>
  );
};
