# Installing DeckPilot on Windows (native)

DeckPilot supports Windows natively as of v0.14 — no WSL required. This
document covers the native Windows install path. (For WSL/Linux/macOS see
[INSTALL.md](INSTALL.md).)

This guide uses **[scoop](https://scoop.sh)** as the package manager
throughout. Scoop is the simplest option on Windows because:

- **No admin / UAC prompts** — installs into your user folder (`~\scoop`).
- **All-user-mode** — no `Program Files` clutter, no Defender headaches.
- **One uninstall command** — `scoop uninstall foo`, no orphaned files.
- **Has poppler** — winget doesn't, chocolatey needs admin.

Where it makes sense the doc also shows the winget equivalents (Node + git
in particular — Microsoft's own tools install cleanly via winget). For
LibreOffice and poppler, **scoop is the recommended path**.

## Two ways to install DeckPilot

You can either:

- **All-in-one** — run the installer and let it offer to install missing
  system deps with a `[y/N]` prompt. See [Quick install](#quick-install).
- **Step-by-step** — verify what's already installed, install any missing
  deps manually, then run the installer with `-NoInstallDeps`. See
  [Recommended workflow](#recommended-workflow-step-by-step). Better on
  corporate / locked-down machines where you want to know exactly what's
  being touched.

## Quick install

Open **PowerShell** (5.1 that ships with Windows is fine; 7+ is better) and:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex
```

That runs the installer non-interactively. Re-running it later auto-detects
the existing install and switches into a fast update path (fetch + rebuild
only).

If you'd rather do every step yourself, skip down to
[Recommended workflow](#recommended-workflow-step-by-step).

## Prerequisites

| | |
|---|---|
| **Windows 10 22H2+ or Windows 11** | Older Windows is missing some package managers. |
| **PowerShell 5.1+** | Ships with Windows. PowerShell 7+ is recommended ([install via scoop](#install-powershell-7-optional)). |
| **scoop** | Recommended package manager. See [Step 0](#step-0--install-scoop-once-per-user). |
| **Node.js ≥ 20** | Required. Via scoop: `scoop install nodejs-lts`. |
| **git** | Required for the bootstrap clone. Via scoop: `scoop install git`. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). |
| **LibreOffice + poppler** | Recommended. Powers vision-driven `template create --from <pptx>` and the visual critique loop. DeckPilot still installs without them — affected features fall back. |

## Recommended workflow (step-by-step)

This is the **conservative path**: install scoop once, verify what's already
there, install any missing deps via scoop, then run the DeckPilot installer
telling it not to touch the system.

### Step 0 — Install scoop (once per user)

#### Verify whether scoop is already installed

```powershell
scoop --version
```

If you see version info like `v0.5.x`, you're done — skip to
[Step 1](#step-1--verify-the-rest-of-your-environment).

If you see `The term 'scoop' is not recognized`, install it:

#### Install scoop

```powershell
# Allow scripts to run for the current user (one-time)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install scoop into ~\scoop (no admin needed)
iwr -useb get.scoop.sh | iex
```

Then verify:

```powershell
scoop --version    # should print v0.5.x or similar
scoop bucket list  # should show "main"
```

If you're behind a corporate proxy / TLS-inspecting firewall and `iwr` fails,
see the [Troubleshooting](#troubleshooting) section.

### Step 1 — Verify the rest of your environment

Run each of these. Anything that doesn't return what's expected goes into
Step 2.

#### Node.js ≥ 20

```powershell
node --version       # should print v20.x.x or higher (v22.x recommended)
npm --version        # should print 10.x or higher
```

If `node` reports "not recognized" or prints v18 or older, install in Step 2.

#### git

```powershell
git --version        # should print "git version 2.x.x.windows.x" or similar
```

#### PowerShell version

```powershell
$PSVersionTable.PSVersion    # 5.1 is fine; 7.x is better
```

#### LibreOffice

LibreOffice usually isn't on `PATH` by default, so check by binary path:

```powershell
# Scoop install location (if you used scoop)
Test-Path "$HOME\scoop\apps\libreoffice\current\program\soffice.exe"

# Or the MSI install location (if you installed manually)
Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'
```

If one returns `True`, you have it. To confirm it actually runs:

```powershell
& 'C:\Program Files\LibreOffice\program\soffice.exe' --version
```

DeckPilot probes both `Program Files` locations automatically — you do
**not** need to add LibreOffice to `PATH`.

#### poppler / pdftoppm

```powershell
Get-Command pdftoppm -ErrorAction SilentlyContinue
# OR explicit version probe:
pdftoppm -v
```

`pdftoppm` writes its version to stderr; if you see something like
`pdftoppm version 23.x.x ...` you have it.

### Step 2 — Install missing prerequisites (all via scoop)

Only run the lines for things that came up missing in Step 1.

#### Install Node 22 LTS

```powershell
scoop install nodejs-lts
```

Re-verify:

```powershell
node --version       # v22.x.x
npm --version
```

> Alternative (Microsoft tool, requires accepting the MSI installer's UAC
> prompt): `winget install OpenJS.NodeJS.LTS`

#### Install git

```powershell
scoop install git
```

Re-verify:

```powershell
git --version
```

> Alternative: `winget install Git.Git`

#### Install LibreOffice (recommended)

```powershell
scoop bucket add extras
scoop install libreoffice
```

Re-verify:

```powershell
Test-Path "$HOME\scoop\apps\libreoffice\current\program\soffice.exe"
```

> Alternative: `winget install --id TheDocumentFoundation.LibreOffice --silent`
> — installs to `C:\Program Files\LibreOffice\`. DeckPilot finds both paths
> automatically.

#### Install poppler (recommended)

```powershell
scoop install poppler
```

Re-verify:

```powershell
pdftoppm -v
```

> winget does not have poppler, and chocolatey requires admin. Scoop is
> the easiest way here.

#### Install PowerShell 7 (optional)

PS 7+ has much better terminal handling than PS 5.1 — the ink TUI renders
nicer:

```powershell
scoop install pwsh
```

Then launch `pwsh` instead of `powershell` going forward.

> Alternative: `winget install Microsoft.PowerShell`

### Step 3 — Run the installer

Now that all the system deps are in place, run the DeckPilot installer with
`-NoInstallDeps` so it skips the system-dep prompt and just installs
DeckPilot itself:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex -Args '-NoInstallDeps'
```

Or, if you'd rather have the script on disk first (lets you read it):

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 -OutFile install.ps1
.\install.ps1 -NoInstallDeps
```

The installer will:

1. Preflight Node ≥ 20, git, disk space, and network reachability to github.com.
2. Skip the system-dep prompt (because of `-NoInstallDeps`).
3. Clone DeckPilot to `%USERPROFILE%\.deckpilot\repo`.
4. Run `npm ci` + `npm run build` + `npx oclif manifest`.
5. Link `deckpilot` globally via `npm link`.
6. Run `deckpilot doctor` and stream its output — your final verification.

If `deckpilot doctor` shows green checks across the board, you're done.
Run `deckpilot` to open the menu.

## What the installer prints

```
DeckPilot installer v0.14.0
· Preflight
✓ Node v22.11.0
✓ Disk: 88420 MB free on drive C:
✓ Network: github.com reachable
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
✓ Visual critique pipeline — C:\Users\you\scoop\apps\libreoffice\current\program\soffice.exe + C:\Users\you\scoop\apps\poppler\current\bin\pdftoppm.exe

DeckPilot is ready.
```

## Parameters

| Parameter | What it does |
|---|---|
| `-System` | Install system-wide via admin-elevated `npm link`. Default is per-user. |
| `-Update` | Force the update fast-path (auto-detected by default on re-run). |
| `-Reinstall` | Skip auto-update detection; run the full path on an existing install. |
| `-InstallDeps` | Install missing system deps without the `[y/N]` prompt. |
| `-NoInstallDeps` | Never auto-install system deps; just print the exact command. Use this when you've installed deps yourself in Step 2. |
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

## Package manager reference

scoop is the recommended path. The other columns are alternatives.

| Dep | scoop (recommended) | winget | choco |
|---|---|---|---|
| **Node.js LTS** | `scoop install nodejs-lts` | `winget install OpenJS.NodeJS.LTS` | `choco install -y nodejs-lts` |
| **git** | `scoop install git` | `winget install Git.Git` | `choco install -y git` |
| **LibreOffice** | `scoop bucket add extras; scoop install libreoffice` | `winget install --id TheDocumentFoundation.LibreOffice --silent` | `choco install -y libreoffice-fresh` |
| **poppler** | `scoop install poppler` | not available | `choco install -y poppler` |
| **PowerShell 7** | `scoop install pwsh` | `winget install Microsoft.PowerShell` | `choco install -y powershell-core` |

DeckPilot's installer auto-detects all three; it just prefers scoop for
poppler since it's the only fully-userspace option.

## Uninstalling via scoop

If you used scoop for everything, you can unwind cleanly:

```powershell
scoop uninstall poppler
scoop uninstall libreoffice
# (only if you want to remove them — Node and git are useful for other things)
```

To remove scoop itself entirely:

```powershell
scoop uninstall scoop
Remove-Item -Recurse -Force $HOME\scoop
```

## poppler manual install (if you really don't want scoop)

1. Download the latest release zip from
   [oschwartz10612/poppler-windows/releases](https://github.com/oschwartz10612/poppler-windows/releases).
2. Extract to `C:\poppler` (or anywhere else).
3. Add `C:\poppler\Library\bin` (path varies by release) to your PATH:

   ```powershell
   [Environment]::SetEnvironmentVariable(
     'Path',
     "$([Environment]::GetEnvironmentVariable('Path','User'));C:\poppler\Library\bin",
     'User'
   )
   ```

4. Open a new terminal and verify:

   ```powershell
   pdftoppm -v
   ```

## LibreOffice manual install (if you really don't want scoop)

1. Download the Windows installer from
   [libreoffice.org/download](https://www.libreoffice.org/download/download/).
2. Run the MSI; accept the defaults.
3. Verify:

   ```powershell
   Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'
   ```

DeckPilot finds `soffice.exe` at this path automatically — no need to add
LibreOffice to PATH.

## Fully manual install (skip install.ps1 entirely)

If `iwr | iex` doesn't work in your environment (e.g. heavy corporate TLS
inspection), do every step by hand:

```powershell
# 1. Clone
git clone https://github.com/marinoscar/deckpilot.git $HOME\.deckpilot\repo

# 2. Build
cd $HOME\.deckpilot\repo
npm ci
npm run build
npx oclif manifest

# 3. Link
npm link

# 4. Verify
deckpilot --version
deckpilot doctor
```

## Update flow

The installer auto-detects re-runs on an existing install:

- Preflight: only checks Node / npm (skips disk / network / deps re-detect).
- Bootstrap: `git fetch` + `git reset --hard origin/<ref>` (no re-clone).
- Build: `npm ci` only if `package-lock.json` actually changed; otherwise
  straight to `npm run build`.
- Link: skipped.
- Verify: `deckpilot doctor` still runs.

Force the full path with `-Reinstall`.

## Uninstall DeckPilot

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
- Your saved DeckPilot projects + templates under
  `%USERPROFILE%\.deckpilot\projects\` and
  `%USERPROFILE%\.deckpilot\templates\`

To wipe DeckPilot's persistent state too:

```powershell
Remove-Item -Recurse -Force $HOME\.deckpilot
```

## Troubleshooting

**"running scripts is disabled on this system"**
Run the one-time `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.

**`scoop` install fails with TLS / certificate errors**
You're likely on a corporate network with TLS inspection. Either ask IT
for the root CA certificate and add it to the Windows Trusted Root
Certification Authorities store (`certmgr.msc`), or use winget for
LibreOffice and the [manual poppler install](#poppler-manual-install-if-you-really-dont-want-scoop)
above.

**`scoop` install fails with execution-policy error**
Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` first.

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
Install LibreOffice (`scoop install libreoffice`) or run with
`--critique-passes 0` to skip the visual loop entirely. DeckPilot still
produces decks without it.

**`deckpilot doctor` says "pdftoppm missing"**
Install poppler (`scoop install poppler`).

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
- LibreOffice and poppler aren't on PATH by default after install
  (especially when installed via scoop). DeckPilot probes their standard
  install locations as a fallback.
- The default terminal on older Windows boxes (`cmd.exe`) has limited
  ANSI support. Use **Windows Terminal** + PowerShell 7+ for the best
  TUI experience. Both are installable via `scoop install windows-terminal`
  + `scoop install pwsh`.
