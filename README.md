# DeckPilot

**Conversational CLI that turns a chat into polished PowerPoint decks, powered by the GitHub Copilot SDK.**

Have a normal conversation in your terminal — DeckPilot proposes the outline, lets you approve it, then writes the rendering code for every slide itself, looking at the rendered PNGs and revising until each one is good. Output: a real `.pptx` you can hand off.

> **Status:** v0.12 — vision-driven brand extraction (`template create --from brand.pptx` reads your slides via LLM vision and writes a rich `TemplateSpec`), a top-level TUI menu when you run `deckpilot` with no args, auto-saving projects with full Copilot session resume, and a trust pass on the chat surface (visible tool errors, clickable preview file links, autosave indicator, auth preflight banner).

---

## Install

### Requirements

| | |
|---|---|
| **Ubuntu / Debian / WSL / Fedora / Arch / openSUSE / macOS** | Native install supported. |
| **Windows (native)** | Supported as of v0.14. Open PowerShell and run `iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 \| iex`. See [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md). For the best TUI experience use Windows Terminal + PowerShell 7+. WSL still works if you prefer it. |
| **Node.js** | ≥ 20 (the installer will fail loudly if it's missing or too old). |
| **GitHub Copilot subscription** | Required — DeckPilot drives `@github/copilot-sdk`, which talks to the Copilot CLI runtime and your Copilot entitlement. |
| **LibreOffice + poppler-utils** (recommended) | Needed for two features: (1) the visual critique loop where the LLM sees its own slides, (2) vision-driven `template create --from brand.pptx`. On Ubuntu/WSL: `sudo apt install libreoffice poppler-utils`. macOS: `brew install --cask libreoffice && brew install poppler`. Without it, DeckPilot still renders decks — just run with `--critique-passes 0`. |

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

This clones DeckPilot into `~/.deckpilot/repo`, installs deps, builds, links the `deckpilot` binary onto your `PATH`, **offers to install LibreOffice + poppler-utils** (the visual pipeline deps), and runs `deckpilot doctor` at the end to verify the install end-to-end. Re-running it is safe — it auto-detects existing installs and switches into a fast update path (fetch + rebuild only).

### From a git clone

```bash
git clone https://github.com/marinoscar/deckpilot.git
cd deckpilot
./install.sh
```

### Installer flags

| Flag | What it does |
|---|---|
| `--system` | Install system-wide via `/usr/local/bin` (uses `sudo`). Default is per-user via `npm link`. |
| `--update` | Force the update fast-path (auto-detected by default when re-running). |
| `--reinstall` | Skip auto-update detection; run the full path on an existing install. |
| `--install-deps` | Install missing system deps without the `[y/N]` prompt (still requires sudo). |
| `--no-install-deps` | Never auto-install system deps; just print the exact command for the detected platform. |
| `--skip-doctor` | Skip the final `deckpilot doctor` verification. |
| `--no-build` | Skip the TypeScript build (dev re-link). |
| `--quiet` | Minimal output. The install log captures the detail. |
| `--log <path>` | Override the install log location. Default: `~/.deckpilot/install.log`. |
| `--uninstall` | Remove the symlink + (if bootstrapped) the clone. Doesn't touch projects/templates. |

Auto-detected platforms (for both deps install and hint mode): `apt` (Ubuntu/Debian/WSL), `dnf` (Fedora/RHEL), `pacman` (Arch/Manjaro), `zypper` (openSUSE), `brew` (macOS).

See [docs/INSTALL.md](docs/INSTALL.md) for the full reference — env vars, manual installs, mirror fallback, resilience, troubleshooting.

### Override the install location

```bash
DECKPILOT_INSTALL_DIR=/opt/deckpilot \
  curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

Other env vars: `DECKPILOT_REPO_URL` (fork support), `DECKPILOT_REPO_MIRRORS` (csv of fallback mirrors), `DECKPILOT_REF` (branch or tag), `DECKPILOT_INSTALL_LOG`.

### Installing Node 20+ on a fresh Ubuntu box

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
deckpilot doctor       # preflight: Node, token, cwd writable, Copilot SDK reachable, LibreOffice pipeline
deckpilot auth login   # if doctor reports no token (uses the Copilot CLI device flow)
deckpilot              # drops into the main menu
```

If `deckpilot doctor` reports `Copilot SDK reachable ✓`, you're done.

---

## The main menu

```bash
deckpilot                  # ← opens the TUI menu
```

```
DeckPilot · conversational PowerPoint, powered by GitHub Copilot

  ▸ Start a new deck                    (s)
    Resume "client-pitch"               (r)    ← jumps straight to your last project
    Manage projects                     (p)
    Manage templates                    (t)
    Settings                            (g)
    Help                                (h)
    Quit                                (q)

  ↑/↓ navigate · Enter select · letter shortcut to jump · q quit
```

Every feature is a menu item with a letter shortcut. From here you can also drive everything by CLI (`deckpilot start`, `deckpilot resume <name>`, `deckpilot template create <name>` …) — the menu is just the discoverable front door.

---

## Workflow

DeckPilot is built around a strict three-phase loop driven by the LLM:

1. **PLAN.** The agent invents a coherent theme (palette + fonts + tone), proposes a `DeckBrief` (meta + theme + one-line purpose per slide), and presents the outline to you in readable prose. **It will not write any slide code until you reply with "build", "go", "yes", "looks good"** or similar. This is enforced in the system prompt — careless `"just build it"` requests still get the outline first.
2. **BUILD.** For each slide, the agent **writes the rendering code itself** — TypeScript that calls a curated `pptxgenjs` slide API — runs it in a `vm` sandbox to produce a real PNG, **looks at the PNG**, finds something to improve on the first pass (drafts are never perfect), and revises. Per-slide budget: up to 5 iterations (default 3).
3. **FINAL REVIEW.** With every slide built, the agent re-previews the deck for cross-slide consistency and makes any final tweaks before writing the `.pptx`.

This is the same pattern claude.ai/design uses, adapted for the terminal: the LLM is the source of truth for layout, not a fixed template library.

```
your chat ─► Copilot SDK
                │
                ├─► propose_deck_brief                   ── meta + theme + per-slide purpose
                │   (user approval gate)
                │
                ├─► write_slide_code                     ── LLM emits TypeScript that calls
                │   slide.addText / slide.addShape /         a frozen pptxgenjs API in a
                │   slide.addImage / …                       vm sandbox; produces a PNG
                │                                             │
                │   PNG written to project + clickable        │ user sees:  🖼 slide cover · pass 1 · file:///…
                │   ◄───────── attached to next turn          ▼
                │             agent sees + critiques     real .pptx via pptxgenjs
                │
                └─► save_deck ──────────────────────────►   deck.pptx (+ brief.json + per-slide .ts sources)
```

The user sees every PNG the LLM is critiquing as a clickable `file://` link in the transcript — open it in iTerm2 / Kitty / WezTerm / VS Code / Warp to confirm what the model is seeing.

---

## Persistent projects

Every chat is automatically saved to `~/.deckpilot/projects/<slug>/`. Walk away, come back three days later:

```bash
deckpilot resume client-pitch          # full continuity:
                                        #   brief + slide code + transcript +
                                        #   the LLM's own memory of the conversation
                                        #   (via Copilot SDK session resume)
```

Project layout:

```
~/.deckpilot/projects/client-pitch/
  project.json        # manifest: { name, createdAt, updatedAt, sessionId, templateName?, … }
  brief.json          # the DeckBrief
  slides/
    cover.slide.ts    # one TypeScript file per LLM-authored slide
    intro.slide.ts
    …
  previews/
    cover-01.png      # every preview the LLM rendered; clickable from chat
    cover-02.png
    …
  transcript.jsonl    # append-only chat history
```

Autosave is debounced 250 ms and runs on every meaningful change. The chat StatusBar shows a `● saved / ● saving / ● failed` dot so you can verify state.

---

## Templates: persistent brand specs

A **template** is a reusable style + voice spec stored at `~/.deckpilot/templates/<name>/`. See [docs/TEMPLATE_SPEC.md](docs/TEMPLATE_SPEC.md) for the full spec.

### Three ways to create one

```bash
# 1. Vision-driven from an existing brand .pptx  ← new in v0.12
deckpilot template create acme --from ~/AcmeBrand.pptx
#    The LLM renders every slide, looks at them via vision, and writes a
#    rich TemplateSpec — palette, fonts, tone, plus dense `guidance` text
#    with quoted observations ("covers full-bleed photography with a
#    1-line title bottom-left in 56pt sans"). Needs LibreOffice + auth.

# 2. Shallow OOXML-only from a .pptx (no LLM, palette+fonts only)
deckpilot template create acme --from ~/AcmeBrand.pptx --shallow

# 3. Blank scaffold to hand-edit
deckpilot template create personal
```

### Use a template

```bash
deckpilot start client-deck --template acme       # CLI flag
# or pick from the startup TUI list, or run `/template acme` mid-session
```

The template's theme (palette + fonts + tone + aspect) drives every slide; its optional `voiceHints` / `copyRules` / `guidance` text is folded into the LLM's system prompt as binding guidance.

### Manage templates

```bash
deckpilot template list
deckpilot template show acme
deckpilot template delete acme --yes
```

…or use the **Manage templates** entry in the main menu (browse, show, create blank, import from `.pptx`, delete — all keyboard-driven).

---

## Inside the chat

Anything you type that doesn't start with `/` is sent to the model. Slash commands are handled locally.

| Slash command | What it does |
|---|---|
| `/help`, `/?` | List slash commands |
| `/outline` | Compact outline of the current brief |
| `/show` | Full `DeckBrief` as JSON |
| `/render [path]` | Render the current deck to `.pptx` |
| `/save` | Force-flush autosave |
| `/save <name>` | Rename the current project + flush |
| `/load <path>` | Load a saved `.brief.json` into the current project |
| `/project` | Show the current project name + path |
| `/project <name>` | Rename the current project |
| `/templates` | List saved templates |
| `/template` | Show the active template |
| `/template <name>` | Switch templates mid-session |
| `/template <path>` | One-shot inheritance from a `.pptx` (no save) |
| `/template none` | Clear the active template |
| `/critique <id>` | Force the LLM to re-preview a specific slide (resets its budget) |
| `/critique-passes <n>` | Set how many preview passes per slide (0 disables, max 5) |
| `/style-guide` | Show the active `DECKPILOT.md` (or note that none was found) |
| `/undo` | Roll back the most recent deck change |
| `/clear` | Reset the on-screen transcript (deck preserved) |
| `/new` | Clear the transcript and decouple from the current project |
| `/model`, `/models` | Inspect or switch the active model |
| `/quit`, `/exit` | Return to the main menu |

**The `@` picker:** type `@` in the prompt to open a popup of `.pptx` and `.brief.json` files in your working directory. Arrow keys to navigate, Enter to insert the path, Esc to cancel. Handy for `/template @brand.pptx` or `/load @last-deck.brief.json`.

**Cancelling:** **Ctrl+C** while a response is streaming aborts the generation but keeps the session alive. A second **Ctrl+C** within ~1s returns to the main menu.

### Status chips

The chat StatusBar surfaces:

```
[idle] model: claude-sonnet-4.5  ·  project: client-pitch  ·  template: acme  ·  ● saved
```

- **model** — active LLM (override with `--model` or `/model <id>`)
- **project** — the auto-saving project name (rename with `/save <name>` or `/project <name>`)
- **template** — active named template, if any
- **● dot** — autosave state: green saved / yellow saving / red failed

---

## DECKPILOT.md — per-directory style guide

Drop a `DECKPILOT.md` in any directory tree and DeckPilot walks up from `cwd` to find it (like `git`). The content is appended to the LLM's system prompt as binding style guidance:

```markdown
# DeckPilot style guide

- Brand accent: #0F62FE; alt #002D9C
- Never use serif fonts
- Slide titles never exceed 6 words
- This quarter's decks use a 5-slide format
```

DECKPILOT.md is **per-cwd-tree** ("rules for whatever I'm building in this folder"). Templates are **per-user-global** ("the Acme Corp brand, reusable across projects"). Both can be active simultaneously.

---

## All top-level commands

```bash
deckpilot                            # open the TUI menu
deckpilot start [<name>]             # start a new deck (alias: chat)
deckpilot resume <name>              # resume a saved project with full LLM memory
deckpilot project list               # list saved projects
deckpilot project show <name>
deckpilot project delete <name> --yes
deckpilot template list              # list saved templates
deckpilot template show <name>
deckpilot template create <name>     # blank scaffold (or --from <pptx> for vision-driven)
deckpilot template create <name> --from <pptx>           # vision-driven extraction
deckpilot template create <name> --from <pptx> --shallow # OOXML-only, no LLM
deckpilot template delete <name> --yes
deckpilot render <brief.json>        # headless render (CI, scripting)
deckpilot doctor                     # preflight diagnostics
deckpilot auth status                # show Copilot auth state
deckpilot auth login                 # device-flow login
deckpilot auth logout
deckpilot models                     # list models the Copilot SDK exposes
deckpilot version
deckpilot help [cmd]                 # detailed per-command help
deckpilot autocomplete               # shell completion install instructions
```

---

## Example session

```bash
# First time — pull in a brand from an existing deck
deckpilot template create acme --from ~/AcmeBrand.pptx

# Start a project against that brand
deckpilot start q4-board --template acme

# Inside chat:
›  make me a 7-slide Q4 board update covering revenue, retention, hiring
   · agent proposes a brief and asks "build?"
›  yes, build it
   · for each slide: write_slide_code → 🖼 file:///... → critique → revise
›  /save                              # forces a flush; project is at ~/.deckpilot/projects/q4-board

# Three days later — resume with full LLM memory
deckpilot resume q4-board
›  what were we just doing?
   · agent remembers the whole conversation; pick up where you left off
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

This unlinks the global binary and removes the bootstrap clone (if any). It does **not** touch your Copilot CLI auth in `~/.copilot/`, nor your saved projects/templates in `~/.deckpilot/`.

To wipe DeckPilot's persistent state:

```bash
rm -rf ~/.deckpilot           # projects + templates + config; irreversible
```

---

## Roadmap

- ✅ **v0.5–v0.7** — Outline-first generation, composition primitives (cards/grids/steps/callouts), visual critique loop, bundled DesignSystem presets.
- ✅ **v0.8** — Strict three-phase PLAN → BUILD → FINAL REVIEW workflow.
- ✅ **v0.9** — Pivot to **code-gen**: the LLM writes per-slide TypeScript against a frozen pptxgenjs surface, executed in a `vm` sandbox. Presets retired.
- ✅ **v0.10** — Persistent **projects** + **named templates** (auto-save + Copilot SDK session resume + reusable brand specs).
- ✅ **v0.11** — Top-level **TUI menu** (`deckpilot` with no args), `start` / `resume` commands, ink-rendered template picker.
- ✅ **v0.12 (current)** — **Vision-driven brand extraction** (`template create --from brand.pptx` reads slides via LLM vision and writes a rich TemplateSpec). Trust-UX sweep: visible tool errors, clickable preview file links, autosave indicator, auth-error banner, Phase 1 gate hardened.

## License

MIT — see [LICENSE](./LICENSE).
