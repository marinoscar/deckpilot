import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { editInExternal, resolveEditor } from '../src/util/external-editor.js';

const root = mkdtempSync(join(tmpdir(), 'deckpilot-edext-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveEditor', () => {
  it('prefers $VISUAL over $EDITOR', () => {
    const old = { v: process.env.VISUAL, e: process.env.EDITOR };
    try {
      process.env.VISUAL = 'mc-editor-visual';
      process.env.EDITOR = 'mc-editor';
      expect(resolveEditor()).toBe('mc-editor-visual');
    } finally {
      process.env.VISUAL = old.v;
      process.env.EDITOR = old.e;
    }
  });

  it('falls back to $EDITOR when $VISUAL is unset', () => {
    const old = { v: process.env.VISUAL, e: process.env.EDITOR };
    try {
      delete process.env.VISUAL;
      process.env.EDITOR = 'mc-editor';
      expect(resolveEditor()).toBe('mc-editor');
    } finally {
      process.env.VISUAL = old.v;
      process.env.EDITOR = old.e;
    }
  });

  it('falls back to platform default when both are unset', () => {
    const old = { v: process.env.VISUAL, e: process.env.EDITOR };
    try {
      delete process.env.VISUAL;
      delete process.env.EDITOR;
      const expected = process.platform === 'win32' ? 'notepad' : 'vi';
      expect(resolveEditor()).toBe(expected);
    } finally {
      process.env.VISUAL = old.v;
      process.env.EDITOR = old.e;
    }
  });
});

describe('editInExternal', () => {
  // Skip on Windows because constructing a stub editor with shebang isn't
  // straightforward; the Linux/macOS smoke is enough to prove the contract.
  it.skipIf(process.platform === 'win32')(
    'returns whatever the stub editor writes to the file',
    async () => {
      const stubDir = mkdtempSync(join(root, 'stub-'));
      const stub = join(stubDir, 'stub-editor.sh');
      writeFileSync(stub, `#!/usr/bin/env bash\nset -e\nprintf 'edited contents' > "$1"\n`);
      chmodSync(stub, 0o755);
      const out = await editInExternal({ editor: stub, initialText: 'before' });
      expect(out).toBe('edited contents');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'preserves the initial text when the editor leaves the file alone',
    async () => {
      // `:` is a no-op shell builtin; touching the file is unnecessary.
      const out = await editInExternal({ editor: 'true', initialText: 'untouched' });
      expect(out).toBe('untouched');
    },
  );
});
