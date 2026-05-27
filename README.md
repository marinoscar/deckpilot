# DeckPilot

**Conversational CLI that turns a chat into polished PowerPoint decks, powered by the GitHub Copilot SDK.**

Have a normal conversation in your terminal — DeckPilot drafts the outline, lets you revise it slide-by-slide, then renders a real `.pptx` you can hand off. Same terminal UX feel as Claude Code or GitHub Copilot CLI, with `pptxgenjs` as the renderer.

> **Status:** v0.8 — workflow tightened. The agent now follows a strict three-phase loop: PLAN (propose a readable per-slide outline → wait for user approval) → BUILD (preview every visually-substantive slide and self-critique honestly) → FINAL REVIEW (deck-wide consistency pass). Each slide gets up to 5 critique iterations (default 3) so the loop actually runs instead of declaring the first draft "good".

---

## Install

### Requirements

| | |
|---|---|
| **Ubuntu / Debian / WSL / macOS** | Native install supported. |
| **Windows** | **WSL is required** — install [WSL 2](https://learn.microsoft.com/en-us/windows/wsl/install), open an Ubuntu shell, then use the Ubuntu instructions below. DeckPilot is a Node + Ink CLI; the Windows console alone is not a supported environment. |
| **Node.js** | ≥ 20 (the installer will fail loudly if it's missing or too old). |
| **GitHub Copilot subscription** | Required — DeckPilot drives `@github/copilot-sdk`, which talks to the Copilot CLI runtime and your Copilot entitlement. |
| **LibreOffice + poppler-utils** (optional) | Needed for the visual critique loop (`render_slide_preview`). On Ubuntu/WSL: `sudo apt install libreoffice poppler-utils`. Without it, DeckPilot still renders decks — just run with `--critique-passes 0` to skip the preview step. |

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
deckpilot doctor       # preflight: Node, token, cwd writable, Copilot SDK reachable, LibreOffice pipeline
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
| `/critique <id>` | Force the LLM to re-preview a specific slide (resets its budget) |
| `/critique-passes <n>` | Set how many preview passes per slide (0 disables, max 5) |
| `/presets` | List the bundled DesignSystem presets the agent can pick |
| `/style-guide` | Show the active `DECKPILOT.md` (or note that none was found) |
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

DeckPilot follows an **outline-first, composition-driven** pattern. The LLM never writes rendering code — it commits to one deck-wide `DesignSystem`, then describes each slide as a *composition* (cards, columns, callouts, etc.), and a deterministic primitive-based renderer turns that into a `.pptx`. Optionally, the agent rasterises slides to PNG so it can see its own work and revise.

```
your chat ─► Copilot SDK
                │
                ├─► apply_design_preset / set_design_system   ── one DesignSystem per deck
                │
                ├─► propose_outline / revise_slide            ── slides composed as
                │                                                 prose | grid | steps |
                │                                                 callout | quote
                │                                                       │
                │   render_slide_preview (LibreOffice ─► PNG)           ▼
                │   ◄───────── image attached to next turn      pptxgenjs primitive
                │             agent sees + critiques            renderer
                │                                                       │
                └─► render_deck / save_deck ──────────────────►   deck.pptx
                                                                  (+ optional .plan.json)
```

The LLM does *content + composition choices + style judgement*. The renderer does *visual execution* — cards, kickers, footer bands, numbered badges, CTA pills, glyphs — drawn from a fixed primitive library so output is consistent across runs. Constraints baked into the schema (max 6 bullets per slide, max 4 columns in a grid, capped title length) enforce restraint.

### What the renderer produces

Slides aren't picked from a fixed layout menu — each one is *composed*. The agent chooses one of five composition kinds per slide:

| Composition | When | What it renders |
|---|---|---|
| **prose** | Ordinary narrative slides | Kicker + title + lead paragraph + up to 6 bullets in accent/muted hierarchy |
| **grid** | The powerhouse — comparisons, progressions, KPI grids | 2/3/4 cards in a row, each with optional kicker, number badge, glyph (table / network / equals / check / cross / spark / bars / pie / grid / cursor), title, body or bullets, accent CTA pill |
| **steps** | Process flows | Horizontal row of numbered badges + titles + descriptions, connected by a thin dashed line |
| **callout** | The chapter takeaway | One oversized statement, optionally with a small "Bottom line:"-style lead |
| **quote** | Pull quote | Oversized accent `"` glyph, italic body, attribution underneath |

Every slide also has an optional **kicker** (small all-caps signpost above the title), **title** + **subtitle**, optional **footer band** (deck title · section · page x/y), and is required to carry **speaker notes**. Decorative habits — kickers, footer band, corner accents, card style (side-bar / top-bar / plain), numbered badge style (circle / pill) — are governed by the DesignSystem so the deck feels consistent end-to-end.

### Controlling style — three knobs

The agent picks a DesignSystem for every deck. You have three ways to steer it, in order of precedence (later wins):

1. **Bundled presets.** The agent prefers one of five named DesignSystems when your prompt fits: `editorial` (navy + red, mirrors the reference designs), `minimal-executive` (charcoal + amber, no chrome), `energetic-startup` (magenta + cyan, top-bar cards), `corporate-blue` (IBM Carbon blue), `studious-academic` (deep green + amber, serif headings). Say "editorial style" or "startup launch deck" in your prompt and the agent reaches for the closest preset. `/presets` lists them.

2. **`--template @brand.pptx`** (or `/template @brand.pptx` mid-session). Parses an existing `.pptx`'s theme — accent colours, accent-dark, ink, muted, paper, heading + body fonts, aspect ratio — and folds them on top of whatever preset the agent chose. The template's slides are NOT imported, only its style.

3. **`DECKPILOT.md`** in cwd (or any ancestor). A persistent markdown file with standing rules. DeckPilot walks up the directory tree like `git` and loads the first match (capped at 12 KB). The rules are injected into the system prompt as a binding style guide. `/style-guide` confirms the active one.

   ```markdown
   # DeckPilot style guide

   - Always use the `corporate-blue` preset
   - Brand accent: #0F62FE (override accent if needed)
   - Never use serif fonts
   - Footer band: on
   - Slide titles never exceed 6 words
   ```

### Workflow (since v0.8)

The agent runs a three-phase loop every time you ask for a deck:

1. **PLAN.** It picks a design system, calls `propose_outline`, then **shows the outline back to you in readable prose** — slide-by-slide with title, subtitle, and a one-line content description. It will not start drawing until you say "build" (or "go", "proceed", "looks good"). Iterate freely; the agent re-presents the updated outline after every change.
2. **BUILD.** For each slide, it calls `render_slide_preview`, looks at the rendered PNG, finds at least one specific improvement on the first preview (assume drafts are never perfect), revises, and moves on once the slide is genuinely good. Per-slide budget: up to 5 critique iterations.
3. **FINAL REVIEW.** Once every slide is built, the agent re-previews the whole deck for cross-slide consistency — alt-accent balance, kicker tone, opener vs closer weight — and makes final tweaks before writing the `.pptx`.

The critique loop depends on `LibreOffice + poppler-utils` being installed. When they're missing, the loop disables itself silently and the agent still writes a deck — it just can't see its own work to self-correct.

```bash
deckpilot chat --critique-passes 5     # max — let the agent grind harder on each slide
deckpilot chat --critique-passes 0     # disable the critique loop entirely
/critique <slide-id>                    # mid-session: reset a specific slide's budget
/critique-passes 4                      # mid-session: change the ceiling
```

Default is 3 per slide; cap is 5.

---

## All top-level commands

```
deckpilot              # enter the chat (alias for `deckpilot chat`)
deckpilot chat         # explicit form: --model, --token, --template, --critique-passes
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
- ✅ **M3** — `.pptx` template inheritance (theme + fonts), `@` file picker, plan reload from `.plan.json`, `inspect_template` tool.
- ✅ **v0.5 — visual overhaul phase 1** — Renderer rewrite around primitives + composition (cards, grids, kickers, CTA pills, footer bands, glyphs). One deck-wide `DesignSystem` governs every slide.
- ✅ **v0.6 — visual overhaul phase 2** — Agentic critique loop. The LLM renders each slide to a PNG via LibreOffice (`render_slide_preview` tool), sees its own work, and revises if it's not good enough. `--critique-passes` flag + `/critique` / `/critique-passes` slash commands.
- ✅ **v0.7 (current) — visual overhaul phase 3** — Five bundled `DesignSystem` presets (editorial, minimal-executive, energetic-startup, corporate-blue, studious-academic), `apply_design_preset` tool, `DECKPILOT.md` project style-guide ingestion, four new glyphs (bars, pie, grid, cursor), `/presets` and `/style-guide` slash commands.
- 🔜 **M5** — Hardening, telemetry opt-in, cross-platform smoke tests, npm publish.

## License

MIT — see [LICENSE](./LICENSE).
