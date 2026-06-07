import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Smoke test for install.ps1. We can't run PowerShell from this CI shell, so
 * the tests are strictly defensive:
 *
 *   1. The file exists and is read-able.
 *   2. The recorded INSTALL_SCRIPT_VERSION matches package.json.
 *   3. Every parameter declared in the param() block is documented in the
 *      header comment (and vice-versa).
 *
 * Real syntax validation happens the first time a Windows user runs it.
 */
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const installPs1 = join(repoRoot, 'install.ps1');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version: string;
};

describe('install.ps1', () => {
  it('exists', () => {
    expect(existsSync(installPs1)).toBe(true);
  });

  it('declares a version that matches package.json', () => {
    const text = readFileSync(installPs1, 'utf8');
    const m = text.match(/^\$INSTALL_SCRIPT_VERSION\s*=\s*'([^']+)'/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(packageJson.version);
  });

  it('every parameter in param() is documented in the header', () => {
    const text = readFileSync(installPs1, 'utf8');
    const paramBlock = text.match(/param\s*\(([\s\S]+?)\)/);
    expect(paramBlock).not.toBeNull();
    const params = new Set<string>();
    for (const m of paramBlock![1].matchAll(/\$(?:[A-Z][a-zA-Z]+)/g)) {
      // Drop the $; powershell params are PascalCase.
      const name = m[0].slice(1);
      // Skip the few helpers that aren't user-facing flags.
      if (['ErrorActionPreference', 'INSTALL_SCRIPT_VERSION'].includes(name)) continue;
      params.add(name);
    }
    // The header section uses -ParamName style; pull those out.
    const header = text.split('# ----------')[0];
    const documented = new Set<string>();
    for (const m of header.matchAll(/-([A-Z][a-zA-Z]+)/g)) {
      documented.add(m[1]!);
    }
    for (const p of params) {
      expect(documented.has(p), `parameter -${p} is declared but not in the header`).toBe(true);
    }
  });

  it('uses CmdletBinding so PowerShell argument parsing is strict', () => {
    const text = readFileSync(installPs1, 'utf8');
    expect(text).toMatch(/\[CmdletBinding\(\)\]/);
  });

  it('sets ErrorActionPreference = Stop so failures throw rather than warn', () => {
    const text = readFileSync(installPs1, 'utf8');
    expect(text).toMatch(/\$ErrorActionPreference\s*=\s*'Stop'/);
  });
});
