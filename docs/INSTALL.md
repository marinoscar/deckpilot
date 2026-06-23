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
| **Windows native** | Supported as of v0.14 via [install.ps1](../install.ps1). See [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md). |

## Requirements

| | |
|---|---|
| **Node.js ≥ 22** | Hard requirement. The installer fails loudly with NodeSource / nvm instructions if missing or too old. |
| **GitHub Copilot subscription** | Required at *runtime* (not install). DeckPilot drives `@github/copilot-sdk`, which authenticates against your Copilot entitlement. |
| **Slide previews** | No system packages required. The **visual critique loop** and **vision-driven `template create --from <pptx>`** render slides in-process via the bundled `pptx-glimpse` dependency. Install any brand fonts (e.g. Inter) you want pixel-faithful previews for — missing fonts are substituted in the preview only, never in the generated `.pptx`. |
| **git** | Only needed for the bootstrap clone, not for local-checkout installs. |
| **curl** | Used for the network preflight; absence is non-fatal (the check is skipped). |
| **≥ 600 MB free** | Required in the install directory's parent. Mostly `node_modules`. |

## How it runs

```
DeckPilot installer v1.3.6
· Preflight
✓ Node 22.22.1
✓ Disk: 14823 MB free in /home/you/.deckpilot
✓ Network: github.com reachable
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
✓ deckpilot/0.21.0 linux-x64 node-v22.22.1
· Running deckpilot doctor
✓ Node ≥ 22 — node v22.22.1
✓ GitHub token resolvable — source: env COPILOT_GITHUB_TOKEN
✓ cwd writable — /home/you
✓ Copilot SDK reachable — ping ok at 2026-05-28T03:54:22Z
✓ Visual critique pipeline — pure-JS preview (pptx-glimpse) — no external binaries needed

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

- preflight: only checks Node / npm (skips disk / network)
- bootstrap: `git fetch` + `git reset --hard origin/<ref>` (no re-clone)
- build: `npm ci` only runs if `package-lock.json` actually changed since
  the previous HEAD; otherwise straight to `npm run build`
- link: skipped (already linked)
- verify: `deckpilot doctor` still runs (catches new deps requirements)

No-op updates take a few seconds. Real updates are bounded by `npm ci` and
`tsc`. Force the full path with `--reinstall`.

## System dependencies

There are none. Slide previews (the visual critique loop and vision-driven
`template create --from <pptx>`) render in-process via the bundled
`pptx-glimpse` dependency — no LibreOffice, no poppler, no `sudo`. The
installer no longer probes for or offers to install system packages.

> Fonts: `pptx-glimpse` draws text with whatever fonts are installed on the
> machine and substitutes a close OSS face for any it can't find (so a preview
> of an Inter deck on a host without Inter still renders, just with a stand-in
> font). This affects the **preview only** — the generated `.pptx` always
> references the real font names. Install the brand fonts you care about for
> pixel-faithful previews.

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

### Node 22+ on a fresh Ubuntu / Debian / WSL box

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

**Install seems to hang on `npm ci`**
Check `~/.deckpilot/install.log` for the live output (the installer pipes
it there). Usually a slow registry / corporate proxy.

**I want to install a specific version / branch**
```bash
DECKPILOT_REF=v1.0.0 ./install.sh          # tag
DECKPILOT_REF=feature/x ./install.sh       # branch
```
