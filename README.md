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

## How it works

DeckPilot follows the **outline-first** pattern: the LLM never writes rendering code, it produces a structured `SlidePlan` via tool calls, and a deterministic renderer turns that plan into a `.pptx`. This is what keeps output consistent across runs.

```
your chat ─► Copilot SDK ──► propose_outline / revise_slide  ──► SlidePlan (zod-validated)
                                                                      │
                                                       (optional)     ▼
                                                       template ─►  pptxgenjs renderer
                                                                      │
                                                                      ▼
                                                                  deck.pptx
```

The LLM does *content* and *layout selection*. The renderer does *visual execution*. Constraints baked into the schema (max 6 bullets per slide, max 2 nesting levels, capped title length) are how DeckPilot enforces visual restraint — the model can't generate cluttered slides because the schema rejects them.

### What the renderer produces

Six slide layouts with deliberate visual design:

| Layout | When | What it renders |
|---|---|---|
| **title** | Opening slide | Big bold title, optional subtitle in muted grey, accent-coloured strip above, author/date pinned to the bottom |
| **content** | Most body slides | Thin accent bar at the top-left, title in accent colour, 3–6 bullets in accent/muted hierarchy, footer with page count |
| **two-col** | Side-by-side comparison | Title above two columns with optional headings, muted vertical divider between them |
| **section** | Chapter divider | Full-bleed accent background, large white title (and optional "01" number for visual rhythm), no footer |
| **quote** | Pull quote | Oversized accent `"` glyph as graphic cue, italic quote text, attribution in muted footer position |
| **closing** | Thanks / contact | Centered title on accent background, optional subtitle and contact line |

All slides get speaker notes (the model is required to populate them). Footers (small, muted "page x of y" + dim deck title) appear on content and two-col slides only — title, section, and closing get breathing room.

**Theme:** defaults to a clean Inter / Inter Tight pair with an IBM Carbon-derived blue (`#0F62FE`). Override per deck via `/template @brand.pptx` (full inheritance from a corporate `.pptx`) or let the LLM set theme colours directly in `propose_outline`.

---

## All top-level commands

```
deckpilot              # enter the chat (alias for `deckpilot chat`)
deckpilot chat         # explicit form: --model, --token, --template flags
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

- ✅ **M1** — Spine: chat loop + streaming + Ctrl+C + slash commands.
- ✅ **M2** — Outline-first generation: zod-validated `SlidePlan`, LLM tools `propose_outline` / `revise_slide` / `render_deck` / `save_deck`, per-deck `.plan.json` for re-editing.
- ✅ **M3 (current)** — `.pptx` template inheritance (theme + fonts), `@` file picker, plan reload from `.plan.json`, `inspect_template` tool.
- 🔜 **M4** — Native charts from structured data (column/line/pie/etc.) + one-shot `deckpilot new "<topic>"` + interactive `deckpilot tutorial`.
- 🔜 **M5** — Hardening, telemetry opt-in, cross-platform smoke tests, npm publish.

---

## License

MIT — see [LICENSE](./LICENSE).
