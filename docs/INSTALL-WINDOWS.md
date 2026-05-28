# Installing DeckPilot on Windows (native)

DeckPilot supports Windows natively as of v0.14 — no WSL required. This
document covers the native Windows install path. (For WSL/Linux/macOS see
[INSTALL.md](INSTALL.md).)

## Two ways to install

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
| **Windows 10 22H2+ or Windows 11** | Older Windows lacks `winget`. |
| **PowerShell 5.1+** | Ships with Windows. PowerShell 7+ is recommended ([install via winget](#installing-powershell-7-optional)). |
| **Node.js ≥ 20** | Required. Install via `winget install OpenJS.NodeJS.LTS` or [nodejs.org](https://nodejs.org). |
| **git** | Required for the bootstrap clone. Install via `winget install Git.Git`. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). |
| **LibreOffice + poppler** | Recommended. Powers vision-driven `template create --from <pptx>` and the visual critique loop. DeckPilot still installs without them — affected features fall back. |

## Recommended workflow (step-by-step)

This is the **conservative path**: verify what's installed first, install any
missing deps manually, then run the installer telling it not to touch the
system.

### Step 1 — Verify your environment

Open PowerShell and run each of these. Anything that doesn't return what's
expected goes into Step 2.

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
Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'
# OR (32-bit install location):
Test-Path 'C:\Program Files (x86)\LibreOffice\program\soffice.exe'
```

If one returns `True`, you have it. To confirm it actually runs:

```powershell
& 'C:\Program Files\LibreOffice\program\soffice.exe' --version
```

DeckPilot probes both locations automatically — you do **not** need to add
LibreOffice to `PATH`.

#### poppler / pdftoppm

```powershell
Get-Command pdftoppm -ErrorAction SilentlyContinue
# OR explicit version probe:
pdftoppm -v
```

`pdftoppm` writes its version to stderr; if you see something like
`pdftoppm version 23.x.x ...` you have it.

#### Package managers (winget / scoop / choco)

```powershell
Get-Command winget, scoop, choco -ErrorAction SilentlyContinue
```

You need at least **one** for Step 2's automated install commands to work.
`winget` ships with Windows 11 and recent Windows 10. `scoop` and `choco`
are user-installed.

### Step 2 — Install missing prerequisites

Only run the lines for things that came up missing in Step 1.

#### Install Node 22 LTS

```powershell
winget install OpenJS.NodeJS.LTS
```

After it finishes, **close your terminal and open a new one** so `PATH`
picks up Node. Then re-verify:

```powershell
node --version       # v22.x.x
npm --version
```

#### Install git

```powershell
winget install Git.Git
```

Open a new terminal. Re-verify:

```powershell
git --version
```

#### Install LibreOffice (recommended)

```powershell
winget install --id TheDocumentFoundation.LibreOffice --silent
```

Re-verify (no need to open a new terminal — DeckPilot probes the install
path directly):

```powershell
Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'
& 'C:\Program Files\LibreOffice\program\soffice.exe' --version
```

> winget does not have poppler. Install it via scoop or chocolatey below.

#### Install poppler (recommended)

If you have **scoop**:

```powershell
scoop install poppler
```

If you have **chocolatey** (admin shell):

```powershell
choco install -y poppler
```

If you have **neither**, the lightest option is to install scoop first:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
iwr -useb get.scoop.sh | iex
scoop install poppler
```

Re-verify in a new terminal:

```powershell
pdftoppm -v
```

#### Installing PowerShell 7 (optional)

PS 7+ has much better terminal handling than PS 5.1 — the ink TUI looks nicer:

```powershell
winget install Microsoft.PowerShell
```

Then launch `pwsh` instead of `powershell` going forward.

### Step 3 — Allow PowerShell scripts to run

If you'll run `install.ps1` from disk (not via `iwr | iex`), enable script
execution for your user once:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

The `iwr | iex` one-liner doesn't trip the execution-policy guard because
the script is piped, not loaded from disk.

### Step 4 — Run the installer

Now that all the system deps are in place, run the installer with
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

| Dep | winget | scoop | choco |
|---|---|---|---|
| **LibreOffice** | `winget install --id TheDocumentFoundation.LibreOffice --silent` | `scoop bucket add extras; scoop install libreoffice` | `choco install -y libreoffice-fresh` |
| **poppler** | not available | `scoop install poppler` | `choco install -y poppler` |
| **Node.js** | `winget install OpenJS.NodeJS.LTS` | `scoop install nodejs-lts` | `choco install -y nodejs-lts` |
| **git** | `winget install Git.Git` | `scoop install git` | `choco install -y git` |

## poppler manual install (if no package manager)

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

## LibreOffice manual install (if no winget)

1. Download the Windows installer from
   [libreoffice.org/download](https://www.libreoffice.org/download/download/).
2. Run the MSI; accept the defaults.
3. Verify the install location:

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
- Your saved DeckPilot projects + templates under
  `%USERPROFILE%\.deckpilot\projects\` and
  `%USERPROFILE%\.deckpilot\templates\`

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
