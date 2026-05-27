# DeckPilot

**Conversational CLI that turns a chat into polished PowerPoint decks, powered by the GitHub Copilot SDK.**

Have a normal conversation in your terminal — DeckPilot drafts the outline, lets you revise it slide-by-slide, then renders a real `.pptx` you can hand off. Same terminal UX feel as Claude Code or GitHub Copilot CLI, with `pptxgenjs` as the renderer.

> **Status:** M3 — templates + file picker shipped. The agent inherits theme colours and fonts from any user-supplied `.pptx` (style only, slides not imported), reloads previously-saved `.plan.json` files for editing, and the `@` picker surfaces relevant files from the working directory. Charts (M4) are next.

---

## Install

### Requirements

| | |
|---|---|
| **Ubuntu / Debian / WSL / macOS** | Native install supported. |
| **Windows** | **WSL is required** — install [WSL 2](https://learn.microsoft.com/en-us/windows/wsl/install), open an Ubuntu shell, then use the Ubuntu instructions below. DeckPilot is a Node + Ink CLI; the Windows console alone is not a supported environment. |
| **Node.js** | ≥ 20 (the installer will fail loudly if it's missing or too old). |
| **GitHub Copilot subscription** | Required — DeckPilot drives `@github/copilot-sdk`, which talks to the Copilot CLI runtime and your Copilot entitlement. |

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

This clones DeckPilot into `~/.deckpilot/repo`, installs deps, builds, and links the `deckpilot` binary onto your `PATH`. Re-run any time — it's idempotent.

### From a git clone

```bash
git clone https://github.com/marinoscar/deckpilot.git
cd deckpilot
./install.sh
```

### Installer flags

| Flag | What it does |
|---|---|
| `--system` | Install system-wide by symlinking `/usr/local/bin/deckpilot` (uses `sudo`). Default is per-user via `npm link`. |
| `--no-build` | Skip the TypeScript build — useful when re-linking during dev. |
| `--uninstall` | Remove the symlink and the bootstrap clone. |
| `--quiet` | Minimal output. |

### Override the install location

```bash
DECKPILOT_INSTALL_DIR=/opt/deckpilot \
  curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

Other env vars: `DECKPILOT_REPO_URL` (fork support), `DECKPILOT_REF` (branch or tag).

### Installing Node 20+ on a fresh Ubuntu box

The installer will tell you if Node is missing. Either route works:

```bash
# Option A — NodeSource (system-wide)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option B — nvm (per-user, easier to upgrade later)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install 22
```

---

## First run

```bash
deckpilot doctor       # preflight: Node, token, cwd writable, Copilot SDK reachable
deckpilot auth login   # if doctor reports no token (uses the Copilot CLI device flow)
deckpilot              # enter the chat loop
```

If `deckpilot doctor` reports `Copilot SDK reachable ✓`, you're done — just run `deckpilot`.

---

## Using the chat

```
deckpilot
```

You drop into an Ink-rendered chat with the Copilot SDK as the brain. Anything you type that doesn't start with `/` is sent to the model. Slash commands are handled locally and never round-trip to the LLM.

| Slash command | What it does |
|---|---|
| `/help`, `/?` | List slash commands |
| `/outline` | Compact outline of the current deck (titles + bullet counts) |
| `/show` | Print the full plan as JSON |
| `/render [path]` | Render the current plan to `.pptx` (default: `./<title>.pptx`) |
| `/save [path]` | Render + also save a `.plan.json` next to the deck for re-editing |
| `/load <path>` | Load a previously-saved `.plan.json` as the working plan |
| `/template <path>` | Inherit theme + fonts from an existing `.pptx` (style only) |
| `/template` | Show the currently-loaded template |
| `/undo` | Roll back the most recent plan change |
| `/clear` | Reset the transcript (keep the deck plan) |
| `/new` | Reset everything |
| `/model`, `/models` | Inspect or switch the active model |
| `/quit`, `/exit` | Exit |

**The `@` picker:** type `@` in the prompt to open a popup of `.pptx` and `.plan.json` files in your working directory. Arrow keys to navigate, Enter to insert the path, Esc to cancel. Handy for `/template @brand.pptx`, `/load @last-deck.plan.json`, or just dropping a file reference into chat.

**Cancelling:** **Ctrl+C** while a response is streaming aborts the generation but keeps the session alive. A second **Ctrl+C** within ~1s exits DeckPilot. (Same convention as Claude Code.)

### Example session

```
› /template @brand.pptx              # picker pops up; pick the brand deck
   ✓ Template loaded: accent #C2410C, fonts: Playfair Display / Source Sans Pro
› make me a 7-slide intro to vector databases for a CTO audience
   · agent calls propose_outline; "Outline accepted (7 slides)"
› revise slide s3 to add a bullet about hybrid search
   · agent calls revise_slide; change applied
› /outline                            # at-a-glance view
› /save                                # writes .pptx + .plan.json (themed!)
```

To pick up where you left off later:
```
› /load @vector-databases.plan.json    # picker shows your saved plans
› change slide s3 to mention pgvector  # iterate
› /save                                # overwrites with new state
```

---

## All top-level commands

```
deckpilot              # enter the chat (alias for `deckpilot chat`)
deckpilot chat         # explicit form, accepts --model and --token flags
deckpilot version      # print version + platform info
deckpilot --version    # short form
deckpilot doctor       # preflight diagnostics
deckpilot auth status  # show current Copilot auth state
deckpilot auth login   # device-flow login (via the bundled Copilot CLI)
deckpilot auth logout
deckpilot models       # list models the Copilot SDK exposes
deckpilot render <plan.json> [--out <pptx>]  # non-interactive render (CI, scripting)
deckpilot help [cmd]   # detailed per-command help
deckpilot autocomplete # set up shell completions
```

---

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash -s -- --uninstall
```

…or, if you cloned manually:

```bash
cd deckpilot && ./install.sh --uninstall
```

This unlinks the global binary and removes the bootstrap clone (if any). It does not touch your Copilot CLI auth in `~/.copilot/`.

---

## Roadmap

- **M1 (current)** — Spine: chat loop + streaming + Ctrl+C + hardcoded `/render`.
- **M2** — Outline-first generation: zod-validated `SlidePlan` + LLM tools `propose_outline`, `revise_slide`, `render_deck`, `save_deck`. Per-session `.deckpilot/` working dirs.
- **M3** — User `.pptx` templates: theme/font/master inheritance via OOXML inspection.
- **M4** — Native charts from structured data (column/line/pie/etc.) + one-shot `deckpilot new "<topic>"` + interactive `deckpilot tutorial`.
- **M5** — Hardening, telemetry opt-in, cross-platform smoke, npm publish.

---

## License

MIT — see [LICENSE](./LICENSE).
