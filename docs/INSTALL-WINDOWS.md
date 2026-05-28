# Installing DeckPilot on Windows (native)

DeckPilot supports Windows natively as of v0.14 — no WSL required. This
document covers the native Windows install path. (For WSL/Linux/macOS see
[INSTALL.md](INSTALL.md).)

## TL;DR

Open **PowerShell** (5.1 that ships with Windows is fine; 7+ is better) and:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex
```

That runs the installer non-interactively. Re-running it later auto-detects
the existing install and switches into a fast update path (fetch + rebuild
only).

## Prerequisites

| | |
|---|---|
| **Windows 10 22H2+ or Windows 11** | Older Windows lacks `winget`. |
| **PowerShell 5.1+** | Ships with Windows. PowerShell 7+ is recommended ([install via winget](#installing-prerequisites-via-winget)). |
| **Node.js ≥ 20** | Install via `winget install OpenJS.NodeJS.LTS` or [nodejs.org](https://nodejs.org). |
| **git** | Install via `winget install Git.Git`. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). |
| **LibreOffice + poppler** (recommended) | For the vision-driven template extractor and the visual critique loop. The installer offers to install them automatically when a supported package manager is detected. |

## One-time setup: execution policy

Windows blocks running unsigned `.ps1` scripts by default. To enable script
execution for your user once:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Or bypass per-invocation:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The `iwr | iex` one-liner doesn't trip the execution-policy guard because the
script is piped, not executed from disk.

## Installing prerequisites via winget

If you don't yet have Node, git, or PowerShell 7+:

```powershell
winget install OpenJS.NodeJS.LTS          # Node 22 LTS
winget install Git.Git                    # git
winget install Microsoft.PowerShell       # PowerShell 7 (optional; PS 5.1 works)
```

Restart your terminal after `node` is installed so PATH picks it up.

## What the installer does

The same flow as the Linux installer:

```
DeckPilot installer v0.14.0
· Preflight
✓ Node v22.11.0
✓ Disk: 88420 MB free on drive C:
✓ Network: github.com reachable
! Missing visual-pipeline deps: libreoffice, poppler
· System dependencies
  Detected package manager(s): winget, scoop
  Plan:
    winget install --id TheDocumentFoundation.LibreOffice --silent
    scoop install poppler
Install libreoffice, poppler now? [y/N] y
  [output streams here]
✓ Visual pipeline deps present (LibreOffice + pdftoppm)
· Cloning https://github.com/marinoscar/deckpilot.git@main → C:\Users\you\.deckpilot\repo
✓ Cloned
· Installing npm deps
✓ Dependencies installed
· Building TypeScript
✓ Build complete
· Generating oclif manifest
✓ Manifest ready
· Linking globally (npm link)
✓ Linked into C:\Users\you\AppData\Roaming\npm\deckpilot.cmd
· Smoke test
✓ deckpilot/0.14.0 win32-x64 node-v22.11.0
· Running deckpilot doctor
✓ Node ≥ 20 — node v22.11.0
✓ GitHub token resolvable — source: env COPILOT_GITHUB_TOKEN
✓ cwd writable — C:\Users\you
✓ Copilot SDK reachable — ping ok at ...
✓ Visual critique pipeline — C:\Program Files\LibreOffice\program\soffice.exe + C:\Users\you\scoop\apps\poppler\current\bin\pdftoppm.exe

DeckPilot is ready.
```

## Parameters

| Parameter | What it does |
|---|---|
| `-System` | Install system-wide via admin-elevated `npm link`. Default is per-user. |
| `-Update` | Force the update fast-path (auto-detected by default on re-run). |
| `-Reinstall` | Skip auto-update detection; run the full path on an existing install. |
| `-InstallDeps` | Install missing system deps without the `[y/N]` prompt. |
| `-NoInstallDeps` | Never auto-install system deps; just print the exact command. |
| `-SkipDoctor` | Skip the final `deckpilot doctor` verification. |
| `-NoBuild` | Skip the TypeScript build (dev re-link). |
| `-Quiet` | Minimal console output (the install log captures the detail). |
| `-Log <path>` | Override the install log location. Default: `$HOME\.deckpilot\install.log`. |
| `-Uninstall` | Remove the symlink + (if bootstrapped) the clone. Doesn't touch projects/templates. |

## Environment variables

Same as `install.sh`:

| Var | Purpose |
|---|---|
| `DECKPILOT_INSTALL_DIR` | Clone target. Default `%USERPROFILE%\.deckpilot\repo`. |
| `DECKPILOT_REPO_URL` | Primary git URL. |
| `DECKPILOT_REPO_MIRRORS` | Comma-separated fallback mirrors. |
| `DECKPILOT_REF` | Git ref (branch/tag/SHA). |
| `DECKPILOT_INSTALL_LOG` | Install log location. |

## Package manager detection

The installer prefers in this order:

| Dep | winget | scoop | choco |
|---|---|---|---|
| **LibreOffice** | `winget install --id TheDocumentFoundation.LibreOffice --silent` | `scoop bucket add extras; scoop install libreoffice` | `choco install -y libreoffice-fresh` |
| **poppler** | not available | `scoop install poppler` | `choco install -y poppler` |

`winget` ships with Windows 11 (and Windows 10 22H2+ with the App Installer
update). `scoop` and `choco` are user-installed. If you have none, the
installer falls through to a hint listing manual download links.

Quick scoop install (PowerShell):

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
iwr -useb get.scoop.sh | iex
```

## LibreOffice on Windows — adding it to PATH

By default the LibreOffice MSI installer does **not** add `soffice.exe` to
PATH. DeckPilot still finds it via fallback paths
(`C:\Program Files\LibreOffice\program\soffice.exe` and the (x86) variant),
so this usually doesn't matter.

If you want it on PATH explicitly:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path',
  "$([Environment]::GetEnvironmentVariable('Path','User'));C:\Program Files\LibreOffice\program",
  'User'
)
```

Open a new terminal afterwards.

## poppler on Windows — manual install (if no package manager)

1. Download the latest release zip from
   [oschwartz10612/poppler-windows/releases](https://github.com/oschwartz10612/poppler-windows/releases).
2. Extract to `C:\poppler` (or anywhere else).
3. Add `C:\poppler\Library\bin` (path varies by release) to your PATH.
4. Verify with `pdftoppm -v` in a new shell.

## Manual install (if `iwr | iex` doesn't work)

```powershell
git clone https://github.com/marinoscar/deckpilot.git $HOME\.deckpilot\repo
cd $HOME\.deckpilot\repo
npm ci
npm run build
npx oclif manifest
npm link
deckpilot doctor
```

## Update flow

The installer auto-detects when you re-run it on an existing install:

- Preflight: only checks Node / npm (skips disk / network / deps re-detect).
- Bootstrap: `git fetch` + `git reset --hard origin/<ref>` (no re-clone).
- Build: `npm ci` only if `package-lock.json` actually changed; otherwise
  straight to `npm run build`.
- Link: skipped.
- Verify: `deckpilot doctor` still runs.

Force the full path with `-Reinstall`.

## Uninstall

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex -Args '-Uninstall'
```

or from a local clone:

```powershell
.\install.ps1 -Uninstall
```

This unlinks the global binary and removes the bootstrap clone (if any). It
does **NOT** touch:

- Your Copilot CLI auth under `%USERPROFILE%\.copilot\`
- Your saved DeckPilot projects + templates under `%USERPROFILE%\.deckpilot\projects\` and `%USERPROFILE%\.deckpilot\templates\`

To wipe DeckPilot's persistent state too:

```powershell
Remove-Item -Recurse -Force $HOME\.deckpilot
```

## Troubleshooting

**"running scripts is disabled on this system"**
Run the one-time `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
above, or pipe the script (`iwr | iex`) instead of executing from disk.

**`deckpilot` not on PATH after install**
Open a new terminal — npm's global bin (`%APPDATA%\npm`) is added to PATH
on first install but existing shells don't pick it up. If it's still not
there after restart, add it manually:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path',
  "$([Environment]::GetEnvironmentVariable('Path','User'));$env:APPDATA\npm",
  'User'
)
```

**`deckpilot doctor` says "libreoffice not found"**
Either install LibreOffice (`winget install TheDocumentFoundation.LibreOffice`)
or run with `--critique-passes 0` to skip the visual loop entirely.
DeckPilot still produces decks without it.

**`deckpilot doctor` says "pdftoppm missing"**
Install poppler via `scoop install poppler` or `choco install -y poppler`,
or grab the binary release linked above and add its `bin\` to PATH.

**TLS errors during `git clone`**
You're likely on a corporate network with TLS inspection. Ask IT for the
root CA certificate and add it to the Windows Trusted Root Certification
Authorities store (`certmgr.msc`). Git on Windows uses the system store
by default, so this fixes it for both git and curl-equivalents.

**Want to run from a fork or branch**

```powershell
$env:DECKPILOT_REF = 'v0.13.0'         # tag
$env:DECKPILOT_REF = 'feature/foo'     # branch
.\install.ps1
```

## What's the same as Linux / macOS

- All runtime functionality. The TUI menu, code-gen pipeline, sandbox,
  projects, templates, autosave, visual critique loop, vision-driven
  template extraction — everything works.
- Project + template storage layout — just under `%USERPROFILE%\.deckpilot\`
  instead of `~/.deckpilot/`.
- `deckpilot doctor` checks the same things.
- Slash commands inside chat are identical.

## What's different from Linux / macOS

- The installer is `install.ps1`, not `install.sh`.
- LibreOffice and poppler aren't on PATH by default after install.
  DeckPilot probes their standard install locations as a fallback.
- The default terminal on older Windows boxes (`cmd.exe`) has limited
  ANSI support. Use **Windows Terminal** + PowerShell 7+ for the best
  TUI experience. Both are available via winget.
