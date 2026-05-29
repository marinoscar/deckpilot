/**
 * Opens the user's preferred external editor on a temp file pre-filled with
 * `initialText`, blocks until they close it, and returns whatever they saved.
 *
 * Editor resolution order:
 *   1. `$VISUAL`
 *   2. `$EDITOR`
 *   3. Platform default — `notepad` on Windows, `vi` everywhere else.
 *
 * Cross-platform notes:
 *   - On Linux/macOS, terminal editors (vi/nano/emacs) work via `stdio: inherit`.
 *   - On Windows, `notepad` blocks the spawned shell until close, so the same
 *     pattern works. GUI editors like `code --wait` also work.
 *   - We use `os.tmpdir()` + `path.join()` so paths are correct on both Windows
 *     and POSIX (no hard-coded `/tmp` or `\\`).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type EditorOptions = {
  /** Optional initial text. Defaults to "". */
  initialText?: string;
  /** Optional file extension hint for the temp file (e.g. ".json"). Defaults to ".txt". */
  extension?: string;
  /**
   * Optional explicit editor binary, overriding env detection. Useful in tests
   * where you want a deterministic editor like `cat` or a stub script.
   */
  editor?: string;
};

/**
 * Resolve which editor binary to launch. Exported so tests / `doctor`
 * can introspect it without spawning.
 */
export function resolveEditor(): string {
  const visual = process.env.VISUAL?.trim();
  if (visual) return visual;
  const editor = process.env.EDITOR?.trim();
  if (editor) return editor;
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

/**
 * Pop out to $EDITOR / $VISUAL (or platform default) on a temp file. Returns
 * the file's contents after the editor closes. Cleans up the temp file
 * regardless of success.
 */
export async function editInExternal(opts: EditorOptions = {}): Promise<string> {
  const editor = opts.editor ?? resolveEditor();
  const ext = opts.extension ?? '.txt';
  const dir = await mkdtemp(join(tmpdir(), 'deckpilot-edit-'));
  const file = join(dir, `edit${ext}`);
  try {
    await writeFile(file, opts.initialText ?? '');
    await runEditor(editor, file);
    return await readFile(file, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // tmp dirs are best-effort; ignore cleanup failures
    });
  }
}

function runEditor(editor: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // shell: true so users can put flags in $EDITOR (e.g. "code --wait").
    const proc = spawn(editor, [file], {
      stdio: 'inherit',
      shell: true,
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Editor "${editor}" exited with code ${code}`));
    });
  });
}
