# Installing DeckPilot

DeckPilot is a Node + ink TUI plus an Oclif CLI. The installer is a single
shell script: `install.sh`. It clones the repo (or uses your local checkout),
builds the TypeScript, links the `deckpilot` binary onto your `PATH`, offers
to install the system dependencies the visual pipeline needs, and runs
`deckpilot doctor` to verify the install end-to-end.

## TL;DR

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

That's the recommended path. Re-running it is safe — by default it switches
into a **fast update mode** when it detects an existing install.

## Supported platforms

| Platform | Notes |
|---|---|
| **Ubuntu / Debian / Pop!_OS** | First-class. Auto-detects `apt`. |
| **Fedora / RHEL** | Auto-detects `dnf`. |
| **Arch / Manjaro** | Auto-detects `pacman`. |
| **openSUSE** | Auto-detects `zypper`. |
| **macOS** | Auto-detects `brew`. Install Homebrew first if missing. |
| **WSL 2** | Treated as Linux + a small flag in the install log. |
| **Windows native** | Not supported. Use WSL. |

## Requirements

| | |
|---|---|
| **Node.js ≥ 20** | Hard requirement. The installer fails loudly with NodeSource / nvm instructions if missing or too old. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). DeckPilot drives `@github/copilot-sdk`, which authenticates against your Copilot entitlement. |
| **LibreOffice + poppler-utils** | Needed for two features: (1) **vision-driven `template create --from <pptx>`** (LLM looks at slides via vision) and (2) the **visual critique loop** where the LLM sees its own renders. DeckPilot still installs without them — affected features fall back. The installer offers to install them automatically (see below). |
| **git** | Only needed for the bootstrap clone, not for local-checkout installs. |
| **curl** | Used for the network preflight; absence is non-fatal (the check is skipped). |
| **≥ 600 MB free** | Required in the install directory's parent. Mostly `node_modules`. |

## How it runs

```
DeckPilot installer v0.13.0
· Preflight
✓ Node 22.22.1
✓ Disk: 14823 MB free in /home/you/.deckpilot
✓ Network: github.com reachable
! Missing visual-pipeline deps: libreoffice poppler
· System dependencies
  Detected OS: linux · package manager: apt
  These deps power vision-driven template extraction (template create --from <pptx>)
  and the visual critique loop. DeckPilot still installs without them — the
  affected features fall back to shallow paths or disable themselves.
Install libreoffice poppler now? [y/N] y
· Running: sudo apt-get update && sudo apt-get install -y libreoffice poppler-utils
  [apt output streams here]
✓ System deps installed.
· Cloning https://github.com/marinoscar/deckpilot.git@main → /home/you/.deckpilot/repo
✓ Cloned from https://github.com/marinoscar/deckpilot.git
· Installing npm deps
✓ Dependencies installed
· Building TypeScript
✓ Build complete
· Generating oclif manifest
✓ Manifest ready
· Linking globally (npm link)
✓ Linked into /usr/local/bin/deckpilot
· Smoke test
✓ deckpilot/0.13.0 linux-x64 node-v22.22.1
· Running deckpilot doctor
✓ Node ≥ 20 — node v22.22.1
✓ GitHub token resolvable — source: env COPILOT_GITHUB_TOKEN
✓ cwd writable — /home/you
✓ Copilot SDK reachable — ping ok at 2026-05-28T03:54:22Z
✓ Visual critique pipeline — soffice found + pdftoppm

DeckPilot is ready.
  Source checkout: /home/you/.deckpilot/repo
  Install log:     /home/you/.deckpilot/install.log
  Try: deckpilot            # open the menu
       deckpilot auth login # if you haven't authenticated Copilot CLI yet
```

## Flags

| Flag | What it does |
|---|---|
| `--system` | Install system-wide via `/usr/local/bin/deckpilot` (uses `sudo`). Default is per-user via `npm link`. |
| `--update` | Force the update fast-path even when auto-detection wouldn't pick it. |
| `--reinstall` | Skip auto-update detection; run the full install path on an existing install. |
| `--install-deps` | Install missing system deps without the `[y/N]` prompt. Useful in CI / scripted installs (still requires sudo). |
| `--no-install-deps` | Never auto-install system deps; just print the exact command for the detected platform. |
| `--skip-doctor` | Skip the final `deckpilot doctor` verification step. |
| `--no-build` | Skip the TypeScript build (dev re-link). |
| `--quiet` | Minimal output (the install log captures the detail). |
| `--log <path>` | Override the install log location. Default: `~/.deckpilot/install.log`. |
| `--uninstall` | Remove the symlink + (if bootstrapped) the clone. Does NOT touch `~/.deckpilot/projects/` or `~/.deckpilot/templates/`. |
| `-h`, `--help` | Print the script's header (this list, with usage). |

## Environment variables

| Var | Purpose |
|---|---|
| `DECKPILOT_INSTALL_DIR` | Where to clone the repo when bootstrapping. Default `$HOME/.deckpilot/repo`. |
| `DECKPILOT_REPO_URL` | Primary git URL to clone. Useful for forks / mirrors. |
| `DECKPILOT_REPO_MIRRORS` | Comma-separated additional mirrors to try if the primary fails. The installer retries each up to 3 times with backoff before moving on. |
| `DECKPILOT_REF` | Git ref (branch / tag / SHA) to check out. Default `main`. |
| `DECKPILOT_INSTALL_LOG` | Where to write the install log. Same as `--log`. |

## Update flow

The installer **auto-detects** when you re-run it on an existing install and
switches into the update fast-path:

- preflight: only checks Node / npm (skips disk / network / deps re-detect)
- bootstrap: `git fetch` + `git reset --hard origin/<ref>` (no re-clone)
- build: `npm ci` only runs if `package-lock.json` actually changed since
  the previous HEAD; otherwise straight to `npm run build`
- link: skipped (already linked)
- verify: `deckpilot doctor` still runs (catches new deps requirements)

No-op updates take a few seconds. Real updates are bounded by `npm ci` and
`tsc`. Force the full path with `--reinstall`.

## Dependency consent: how it decides

| Scenario | Default | With `--install-deps` | With `--no-install-deps` |
|---|---|---|---|
| TTY + deps missing | `[y/N]` prompt; install on `y` | install without prompt | print command, skip install |
| No TTY (`curl \| bash`) + deps missing | print command, skip install | install without prompt | print command, skip install |
| Deps present | nothing | nothing | nothing |

Sudo is invoked **only** after explicit consent (either by answering `y` or
by passing `--install-deps`).

The exact command shown / run is platform-specific:

| Platform | LibreOffice + poppler |
|---|---|
| apt (Ubuntu/Debian/WSL) | `sudo apt-get update && sudo apt-get install -y libreoffice poppler-utils` |
| dnf (Fedora) | `sudo dnf install -y libreoffice poppler-utils` |
| pacman (Arch) | `sudo pacman -Sy --noconfirm libreoffice-fresh poppler` |
| zypper (openSUSE) | `sudo zypper --non-interactive install libreoffice poppler-tools` |
| brew (macOS) | `brew install --cask libreoffice && brew install poppler` |

## Resilience

- **Retry**: clone + `npm ci` each retry up to 3× with linear backoff.
- **Mirror fallback**: set `DECKPILOT_REPO_MIRRORS="url1,url2"` to try
  alternatives when the primary GitHub URL fails (regional blockers, etc.).
- **Rollback**: a hard failure during install removes the partial bootstrap
  clone; a hard failure during update `git reset --hard` to the previous
  HEAD. Either way, the installer never leaves the system half-broken.
- **Install log**: every step's stdout/stderr is appended to
  `~/.deckpilot/install.log` (override with `--log`). Truncated per-run.

## Common manual installs

### Node 20+ on a fresh Ubuntu / Debian / WSL box

```bash
# Option A — NodeSource (system-wide)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option B — nvm (per-user)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install 22
```

### Homebrew on a fresh macOS

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### LibreOffice + poppler — if you'd rather install manually

Run whichever line applies to your platform from the table above, then
re-run `./install.sh` (or just `deckpilot doctor`) to verify.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash -s -- --uninstall
```

…or, from a local clone:

```bash
./install.sh --uninstall
```

This unlinks the global binary and removes the bootstrap clone (if any). It
does **NOT** touch:

- Your Copilot CLI auth in `~/.copilot/`
- Your saved DeckPilot projects + templates in `~/.deckpilot/projects/` and
  `~/.deckpilot/templates/`

To wipe DeckPilot's persistent state too:

```bash
rm -rf ~/.deckpilot           # projects + templates + config + install log. Irreversible.
```

## Troubleshooting

**"npm link reported success but `$prefix/bin/deckpilot` is missing"**
A known nvm + WSL quirk where `npm link` silently no-ops. The installer
automatically falls back to a direct symlink at the same path. If you
still don't see `deckpilot` on `PATH`, check that `$(npm prefix -g)/bin`
is on `PATH`.

**Doctor says "Copilot SDK reachable ✗"**
Run `deckpilot auth login`. The installer prints this hint at the end if
auth is the only thing missing.

**"Cannot reach https://github.com"** during preflight
Network outage / firewall / proxy. The installer exits before touching
anything destructive. Fix connectivity and re-run.

**The `[y/N]` prompt for system deps never appears**
You're running under `curl | bash` (no TTY). Re-run with
`--install-deps` to skip the prompt and install, or download `install.sh`
locally first and run it interactively.

**Install seems to hang on `npm ci`**
Check `~/.deckpilot/install.log` for the live output (the installer pipes
it there). Usually a slow registry / corporate proxy.

**I want to install a specific version / branch**
```bash
DECKPILOT_REF=v0.12.0 ./install.sh         # tag
DECKPILOT_REF=feature/x ./install.sh       # branch
```
