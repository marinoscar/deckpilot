# Installing DeckPilot on Windows (native)

DeckPilot supports Windows natively as of v0.14 — no WSL required. This
document covers the native Windows install path. (For WSL/Linux/macOS see
[INSTALL.md](INSTALL.md).)

The only real prerequisite is **Node.js ≥ 22**. Slide previews are pure-JS
(the bundled `pptx-glimpse` dependency) — there are **no system packages to
install** (no LibreOffice, no poppler). This guide uses
**[scoop](https://scoop.sh)** for Node because it's the simplest option on
Windows:

- **No admin / UAC prompts** — installs into your user folder (`~\scoop`).
- **All-user-mode** — no `Program Files` clutter, no Defender headaches.
- **One uninstall command** — `scoop uninstall foo`, no orphaned files.

The doc also shows the winget equivalent for Node (Microsoft's own tools
install cleanly via winget).

## How install.ps1 actually downloads

`install.ps1` does **not** use `git clone`. It downloads the GitHub zip
tarball via `Invoke-WebRequest` and extracts with `Expand-Archive`. This
matters on corporate Windows machines: PowerShell's `Invoke-WebRequest`
uses **Schannel** (the Windows native TLS stack) which already trusts
your corporate root CA — Edge browses to github.com fine because of
this. Git for Windows defaults to OpenSSL with its own bundled CA store
which does NOT trust the corporate root, so `git clone` fails on the
same network. The zip path side-steps that entirely. As a bonus, **git
is no longer a required prerequisite**.

## Two ways to install DeckPilot

You can either:

- **Quick** — run the one-liner and let it do everything. See
  [Quick install](#quick-install).
- **Step-by-step** — install Node yourself, then run the installer. See
  [Recommended workflow](#recommended-workflow-step-by-step). Better on
  corporate / locked-down machines where you want to know exactly what's
  being touched.

## Quick install

Open **PowerShell** (5.1 that ships with Windows is fine; 7+ is better) and:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex
```

That runs the installer non-interactively. Re-running it later auto-detects
the existing install and switches into a fast update path (re-download +
rebuild only, with `node_modules` preserved when `package-lock.json`
hasn't changed).

If you'd rather do every step yourself, skip down to
[Recommended workflow](#recommended-workflow-step-by-step).

## Prerequisites

| | |
|---|---|
| **Windows 10 22H2+ or Windows 11** | Older Windows is missing some package managers. |
| **PowerShell 5.1+** | Ships with Windows. PowerShell 7+ is recommended ([install via scoop](#install-powershell-7-optional)). |
| **scoop** | Recommended package manager (for installing Node). See [Step 0](#step-0--install-scoop-once-per-user). |
| **Node.js ≥ 22** | Required. Via scoop: `scoop install nodejs-lts`. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). |

**Not required:** git (the installer uses zip download), and no LibreOffice /
poppler — slide previews are pure-JS via the bundled `pptx-glimpse` dependency.

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

If you're behind a corporate proxy / TLS-inspecting firewall and `iwr`
fails, see
[Corporate / locked-down machines](#corporate--locked-down-machines).

### Step 1 — Verify the rest of your environment

Run each of these. Anything that doesn't return what's expected goes into
Step 2.

#### Node.js ≥ 22

```powershell
node --version       # should print v22.x.x or higher
npm --version        # should print 10.x or higher
```

If `node` reports "not recognized" or prints v20 or older, install in Step 2.

#### PowerShell version

```powershell
$PSVersionTable.PSVersion    # 5.1 is fine; 7.x is better
```

That's the only hard prerequisite — there's no LibreOffice or poppler to
check for anymore.

### Step 2 — Install missing prerequisites (via scoop)

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

#### Install PowerShell 7 (optional)

PS 7+ has much better terminal handling than PS 5.1 — the ink TUI renders
nicer:

```powershell
scoop install pwsh
```

Then launch `pwsh` instead of `powershell` going forward.

> Alternative: `winget install Microsoft.PowerShell`

### Step 3 — Run the installer

Now that Node is in place, run the DeckPilot installer:

```powershell
# Download the installer to disk first — see the "tip" box below for why
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 -OutFile install.ps1

# Verify what you got before running
Select-String -Path install.ps1 -Pattern 'INSTALL_SCRIPT_VERSION'

# Run from disk
.\install.ps1
```

> **Tip — prefer downloading to disk over `iwr | iex`.** When the script
> is piped into `iex` and hits a hard failure, the whole PowerShell
> window can close before you see the error. Running `.\install.ps1`
> from disk keeps the shell open on failure so you can read the
> traceback. (v0.14.2 onwards uses `throw` instead of `exit` to mitigate
> this, but downloading first is still the more debuggable habit.)

The installer will:

1. Preflight Node ≥ 22, disk space, and network reachability to github.com.
2. Download the GitHub zip tarball via `Invoke-WebRequest` to
   `%USERPROFILE%\.deckpilot\repo`.
3. Run `npm ci` + `npm run build` + `npx oclif manifest`.
4. Link `deckpilot` globally via `npm link`.
5. Run `deckpilot doctor` and stream its output — your final verification.

## What the installer prints (v0.14.5+)

```
DeckPilot installer v0.21.0
· Preflight
✓ Node 22.11.0
✓ Disk: 63437 MB free on drive C:
✓ Network: github.com reachable
· Downloading https://github.com/marinoscar/deckpilot/archive/refs/heads/main.zip
✓ Downloaded + extracted from https://github.com/marinoscar/deckpilot/archive/refs/heads/main.zip
· Installing npm deps
✓ Dependencies installed
· Building TypeScript
✓ Build complete
· Generating oclif manifest
✓ Manifest ready
· Linking globally (npm link)
✓ Linked into C:\Users\you\AppData\Roaming\npm\deckpilot.cmd
· Smoke test
✓ deckpilot/0.21.0 win32-x64 node-v22.11.0
· Running deckpilot doctor
✓ Node ≥ 22 — node v22.11.0
✓ GitHub token resolvable — source: ...
✓ cwd writable — C:\Users\you
✓ Copilot SDK reachable — ping ok at ...
✓ Visual critique pipeline — pure-JS preview (pptx-glimpse) — no external binaries needed

DeckPilot is ready.
  Source:      C:\Users\you\.deckpilot\repo
  Install log: C:\Users\you\.deckpilot\install.log
  Try: deckpilot            # open the menu
       deckpilot auth login # if you haven't authenticated Copilot CLI yet
```

## Verifying the install worked

```powershell
# In a NEW PowerShell window (so PATH refreshes from the npm link)
deckpilot --version
deckpilot doctor
deckpilot                  # opens the TUI menu
```

If `deckpilot` opens a menu titled "DeckPilot · conversational PowerPoint…"
with rows like "Start a new deck / Resume a deck / Manage projects /
Manage templates / Settings / Help / Quit", you're fully shipped.

If `deckpilot --version` reports "not recognized", open a new shell — npm's
global bin needs PATH to refresh. If still missing:

```powershell
$env:Path = "$([Environment]::GetEnvironmentVariable('Path','User'));$env:APPDATA\npm"
deckpilot --version
```

## Parameters

| Parameter | What it does |
|---|---|
| `-System` | Install system-wide via admin-elevated `npm link`. Default is per-user. |
| `-Update` | Force the update fast-path (auto-detected by default on re-run). |
| `-Reinstall` | Skip auto-update detection; run the full path on an existing install. |
| `-SkipDoctor` | Skip the final `deckpilot doctor` verification. |
| `-NoBuild` | Skip the TypeScript build (dev re-link). |
| `-Quiet` | Minimal console output (the install log captures the detail). |
| `-Log <path>` | Override the install log location. Default: `$HOME\.deckpilot\install.log`. |
| `-Uninstall` | Remove the symlink + (if bootstrapped) the install dir. Doesn't touch projects/templates. |

## Environment variables

Same as `install.sh`:

| Var | Purpose |
|---|---|
| `DECKPILOT_INSTALL_DIR` | Where to extract the source. Default `%USERPROFILE%\.deckpilot\repo`. |
| `DECKPILOT_REPO_URL` | Primary GitHub URL (used to derive the zip URL). |
| `DECKPILOT_REPO_MIRRORS` | Comma-separated fallback GitHub URLs. |
| `DECKPILOT_REF` | Branch / tag / SHA to download. Default `main`. |
| `DECKPILOT_INSTALL_LOG` | Install log location. |

## Package manager reference

scoop is the recommended path. The other columns are alternatives.

| Dep | scoop (recommended) | winget | choco |
|---|---|---|---|
| **Node.js LTS** | `scoop install nodejs-lts` | `winget install OpenJS.NodeJS.LTS` | `choco install -y nodejs-lts` |
| **PowerShell 7** | `scoop install pwsh` | `winget install Microsoft.PowerShell` | `choco install -y powershell-core` |

Node is the only runtime dependency — slide previews are pure-JS, so there's
no LibreOffice or poppler to install.

## Update flow

The installer auto-detects re-runs on an existing install:

- **Preflight:** only checks Node / npm (skips disk / network).
- **Bootstrap:** existing `$RepoDir` is renamed to `$RepoDir.backup`, then
  the latest zip is downloaded and extracted into a fresh `$RepoDir`. The
  previous `node_modules` is moved across into the new dir if it exists.
- **Build:** `npm ci` runs only if `package-lock.json` actually changed
  (SHA1 hash compared between old and new); otherwise straight to
  `npm run build`.
- **Link:** skipped.
- **Verify:** `deckpilot doctor` still runs.
- **Cleanup:** `$RepoDir.backup` is removed on success. On any failure,
  the backup is restored to the original location.

Force the full path with `-Reinstall`.

## Uninstall DeckPilot

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 -OutFile install.ps1
.\install.ps1 -Uninstall
```

or from a local clone:

```powershell
.\install.ps1 -Uninstall
```

This unlinks the global binary and removes the bootstrap install dir (if
any). It does **NOT** touch:

- Your Copilot CLI auth under `%USERPROFILE%\.copilot\`
- Your saved DeckPilot projects + templates under
  `%USERPROFILE%\.deckpilot\projects\` and
  `%USERPROFILE%\.deckpilot\templates\`

To wipe DeckPilot's persistent state too:

```powershell
Remove-Item -Recurse -Force $HOME\.deckpilot
```

## Corporate / locked-down machines

Almost every install issue on a managed Windows box traces back to one of
three things: TLS interception, stale CDN cache, or a UAC / execution
policy block. Here's the playbook we've worked out.

### TLS interception — diagnosing it

Corporate networks often run TLS-inspecting proxies (Zscaler, Netskope,
Cisco Umbrella, Palo Alto, etc.) that re-sign HTTPS traffic with their own
root CA. The Windows certificate store trusts that root (IT installs it
system-wide), so:

- **PowerShell `Invoke-WebRequest` works** — it uses Schannel + the
  Windows cert store.
- **`git clone` may fail** — Git for Windows defaults to OpenSSL with its
  own bundled CA file, which does NOT have the corporate root.
- **`scoop install foo` may fail** at the download step for the same
  reason if scoop is shelling out to a tool that uses its own cert store.

Quick test to confirm Schannel works for HTTPS to GitHub:

```powershell
iwr -useb -Method Head https://github.com >$null
echo "github.com reachable via Schannel"
```

If that succeeds, **install.ps1 will work** — it uses the same transport.
The DeckPilot installer no longer needs `git clone` at all.

### Stale CDN cache for raw.githubusercontent.com

Corporate proxies often cache content by **URL path only**, ignoring
query strings. So `iwr ...install.ps1?nc=$(Get-Random)` gets served from
cache even though the URL is technically unique. To bust the cache,
**use a commit SHA in the URL** — the proxy can't have it cached because
the URL is genuinely new:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/<commit-sha>/install.ps1 -OutFile install.ps1
```

Find the latest commit SHA from the
[releases page](https://github.com/marinoscar/deckpilot/commits/main) or
just visit the repo and copy the short SHA from a recent commit.

If even the SHA-URL gets served stale, try the codeload mirror (different
CDN path):

```powershell
iwr -useb https://github.com/marinoscar/deckpilot/raw/<sha>/install.ps1 -OutFile install.ps1
```

### When `iwr | iex` closes the window before you can read the error

PowerShell's `iex` runs the script body **inside your current session**,
so any `exit` call terminates the host. v0.14.2+ uses `throw` to surface
errors without closing the session, but the safer habit is to download
the script to disk first and run from there:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 -OutFile install.ps1
.\install.ps1
```

Errors land in the terminal, the window stays open, and you can also
inspect the install log afterwards.

### The install log

Always available, always per-run truncated, always populated even on
failure:

```powershell
Get-Content $HOME\.deckpilot\install.log
```

If you hit something the script doesn't surface clearly, the log usually
has the underlying error. Common things to look for:

- `npm warn` lines — usually harmless. v0.14.5+ doesn't fail on them.
- `npm error` lines — real failure; the surrounding lines say why.
- `Expand-Archive` errors — partial / corrupt download. Re-run.
- Anything with `OpenSSL` / `SSL` / `certificate` / `verify` — TLS
  interception. Schannel-based downloads (the installer's path) should
  side-step this; if you see it from another tool, that tool is using
  OpenSSL.

## Troubleshooting

**"running scripts is disabled on this system"**
Run the one-time `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.

**The PowerShell window closes on error**
Download the installer to disk first instead of piping into `iex`:

```powershell
iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 -OutFile install.ps1
.\install.ps1
```

**Wrong installer version even after re-running the download**
Your corporate proxy is caching by URL path. Pin to a specific commit
SHA: see [Stale CDN cache](#stale-cdn-cache-for-rawgithubusercontentcom).

**Garbled symbols where the installer shows `·`, `✓`, `✗`**
You're running an older version (pre-v0.14.3) under PowerShell 5.1.
Re-download the latest `install.ps1` — the file now has a UTF-8 BOM
and uses literal characters instead of the PS 7+ `` `u{...} `` escape.

**`scoop` install fails with TLS / certificate errors**
Same root cause as Git for Windows — scoop's downloader uses OpenSSL.
Easier fix: install Node via `winget install OpenJS.NodeJS.LTS` instead.

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

**`deckpilot doctor` says the visual critique pipeline is unavailable**
Reinstall dependencies (`npm install` in the repo) — the pure-JS
`pptx-glimpse` renderer ships as a bundled dependency, so this should never
happen on a healthy install. You can always run with `--critique-passes 0`
to skip the visual loop entirely; DeckPilot still produces decks.

**`deckpilot doctor` says "Copilot SDK reachable ✗"**
Run `deckpilot auth login`. Most fresh installs need this once.

**Install fails at `npm warn ...` line**
Update to v0.14.5+. Earlier versions treated any native-command stderr
(including npm warnings) as a fatal error.

**Install fails at `git clone`**
Update to v0.14.4+. The installer no longer uses git.

**Want to run from a fork or branch**

```powershell
$env:DECKPILOT_REF = 'v0.14.4'         # tag
$env:DECKPILOT_REF = 'feature/foo'     # branch
.\install.ps1
```

## Uninstalling scoop itself

To remove scoop entirely:

```powershell
scoop uninstall scoop
Remove-Item -Recurse -Force $HOME\scoop
```

## Manual install paths

### Fully manual install (skip install.ps1 entirely)

If `iwr | iex` doesn't work in your environment and you don't want to use
the script at all, do every step by hand. No git required:

```powershell
# 1. Download the tarball (Schannel works on corporate boxes; git clone may not)
iwr -useb https://github.com/marinoscar/deckpilot/archive/refs/heads/main.zip `
    -OutFile $env:TEMP\deckpilot.zip

# 2. Extract
$dest = "$HOME\.deckpilot"
if (Test-Path "$dest\repo") { Remove-Item -Recurse -Force "$dest\repo" }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $env:TEMP\deckpilot.zip -DestinationPath $dest -Force
Rename-Item -Path "$dest\deckpilot-main" -NewName "repo"

# 3. Build + link
Push-Location "$dest\repo"
npm ci
npm run build
npx oclif manifest
npm link
Pop-Location

# 4. Verify (open a new shell so PATH refreshes)
deckpilot --version
deckpilot doctor
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

- The installer is `install.ps1` (zip download), not `install.sh`
  (git clone). git is not a Windows prerequisite.
- The default terminal on older Windows boxes (`cmd.exe`) has limited
  ANSI support. Use **Windows Terminal** + PowerShell 7+ for the best
  TUI experience. Both are installable via `scoop install windows-terminal`
  + `scoop install pwsh`.
