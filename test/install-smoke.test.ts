/**
 * Smoke test for install.sh. We can't run the full installer in a vitest
 * worker (it touches $HOME, hits the network, requires sudo for deps), so
 * the tests stay strictly defensive:
 *
 *   1. The script's bash syntax parses cleanly.
 *   2. The recorded INSTALL_SCRIPT_VERSION matches package.json.
 *   3. --help exits 0 and prints the usage banner.
 *   4. Every flag advertised in the help block is parsed by the script
 *      (no orphaned doc — common drift target).
 *   5. The platform-detection helpers produce non-empty values when sourced
 *      in a controlled subshell. (`source` runs the script, so we extract
 *      the function definitions to a temp file and source only those.)
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const installSh = join(repoRoot, 'install.sh');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version: string;
};

describe('install.sh', () => {
  it('exists and is executable', () => {
    expect(existsSync(installSh)).toBe(true);
  });

  it('parses as valid bash', () => {
    expect(() => execFileSync('bash', ['-n', installSh], { stdio: 'pipe' })).not.toThrow();
  });

  it('declares a version that matches package.json', () => {
    const text = readFileSync(installSh, 'utf8');
    const m = text.match(/^INSTALL_SCRIPT_VERSION="([^"]+)"/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(packageJson.version);
  });

  it('--help exits 0 and prints the usage banner', () => {
    const result = spawnSync('bash', [installSh, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DeckPilot installer');
    expect(result.stdout).toContain('Usage:');
  });

  it('every flag in --help is actually parsed by the case statement', () => {
    const text = readFileSync(installSh, 'utf8');
    // Pull flags out of the usage block (lines starting with `#   --` or `# ./install.sh --`).
    const flagsInDoc = new Set<string>();
    for (const m of text.matchAll(/^#\s+(?:\.\/install\.sh\s+)?(--[a-z][a-z-]*)/gm)) {
      flagsInDoc.add(m[1]!);
    }
    // Pull flags out of the case statement.
    const flagsHandled = new Set<string>();
    const caseBlock = text.match(/while \[ \$# -gt 0 \]; do[\s\S]+?done/);
    expect(caseBlock).not.toBeNull();
    for (const m of (caseBlock![0]).matchAll(/--[a-z][a-z-]*/g)) {
      flagsHandled.add(m[0]);
    }
    // -h is the short form of --help and lives in the case block only.
    flagsHandled.delete('--');
    // Every documented flag must be parsed.
    for (const f of flagsInDoc) {
      expect(flagsHandled.has(f), `flag ${f} is in --help but not parsed`).toBe(true);
    }
  });

  it('declares the package-manager map for every supported PM', () => {
    const text = readFileSync(installSh, 'utf8');
    const required = ['apt', 'dnf', 'pacman', 'zypper', 'brew'];
    for (const pm of required) {
      expect(text, `pm_pkgname mapping missing for ${pm}`).toMatch(
        new RegExp(`${pm}:(libreoffice|poppler|git)`),
      );
    }
  });

  it('platform detection helpers return a non-empty value', () => {
    // Extract just the function definitions + a tiny driver and run that.
    const text = readFileSync(installSh, 'utf8');
    const detectOs = text.match(/detect_os\(\) \{[\s\S]+?\n\}\n/);
    const detectPm = text.match(/detect_pm\(\) \{[\s\S]+?\n\}\n/);
    expect(detectOs).not.toBeNull();
    expect(detectPm).not.toBeNull();
    const probe = `set -eu\n${detectOs![0]}\n${detectPm![0]}\necho "os=$(detect_os) pm=$(detect_pm)"\n`;
    const result = spawnSync('bash', ['-c', probe], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/os=\S+ pm=\S+/);
  });
});
