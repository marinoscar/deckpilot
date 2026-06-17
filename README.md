# DeckPilot

**Conversational CLI that turns a chat into polished PowerPoint decks, powered by the GitHub Copilot SDK.**

Have a normal conversation in your terminal — DeckPilot proposes the outline, lets you approve it, then writes the rendering code for every slide itself, looking at the rendered PNGs and revising until each one is good. Output: a real `.pptx` you can hand off.

> **Status:** v1.3 — the full create → transform → improve workflow is in place, the install is pure-JS (no system packages), and the CLI/TUI surfaces are at parity. See the [Roadmap](#roadmap) for the per-version history.

---

## Install

### Requirements

| | |
|---|---|
| **Ubuntu / Debian / WSL / Fedora / Arch / openSUSE / macOS** | Native install supported. |
| **Windows (native)** | Supported as of v0.14. Open PowerShell and run `iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 \| iex`. See [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md). For the best TUI experience use Windows Terminal + PowerShell 7+. WSL still works if you prefer it. |
| **Node.js** | ≥ 22 (the installer will fail loudly if it's missing or too old). |
| **GitHub Copilot subscription** | Required — DeckPilot drives `@github/copilot-sdk`, which talks to the Copilot CLI runtime and your Copilot entitlement. |
| **Slide previews** | Work out of the box — no system packages. Previews (the visual critique loop + vision-driven `template create --from brand.pptx`) are rendered in-process by [`pptx-glimpse`](https://github.com/hirokisakabe/pptx-glimpse), a bundled dependency. Install fonts you want pixel-faithful previews for (e.g. Inter); missing fonts are substituted in the preview only. |

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
```

This clones DeckPilot into `~/.deckpilot/repo`, installs deps, builds, links the `deckpilot` binary onto your `PATH`, and runs `deckpilot doctor` at the end to verify the install end-to-end. No system packages to install — previews are pure-JS. Re-running it is safe — it auto-detects existing installs and switches into a fast update path (fetch + rebuild only).

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

### Installing Node 22+ on a fresh Ubuntu box

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
deckpilot doctor       # preflight: Node, token, cwd writable, Copilot SDK reachable, preview renderer
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

  ❯ Start a new deck                    (s)
    Transform a deck                    (x)    ← reproduce a deck's content in another deck's style
    Improve a deck                      (i)    ← quality-check a deck and rebuild a better version
    Resume a deck                       (r)    ← jumps straight to a saved project
    Manage projects                     (p)
    Manage templates                    (t)
    Manage skills                       (k)
    Settings                            (g)
    Doctor                              (d)    ← preflight diagnostics: Node, auth, Copilot SDK, preview
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
# 1. From an existing brand .pptx (recommended) — v0.16+
deckpilot template create acme --from ~/AcmeBrand.pptx
#    The OOXML extractor pulls:
#      - the source's brand master (background, logo, footer chrome),
#        copying media into ~/.deckpilot/templates/acme/assets/
#      - the title slide's full-bleed cover background into
#        assets/cover-background.* (v0.17), deduped against the master bg
#      - a distinct content background for body slides (v0.18) —
#        master.background: an image, or a solid fill in the deck's
#        paper colour when the deck has no content background image
#      - paletteSamples — every distinct hex the source uses prominently
#        (cards, chart series, accents) sorted by frequency, capped at 12
#      - themePalette — the named brand swatches from theme1.xml's
#        clrScheme (accent1-6, dark/light, hyperlinks) (v0.17)
#      - donorGeometry — each source slide's named-shape layout catalog
#        (positions in inches, fonts, fills, sample text)
#    Then a vision-driven LLM pass authors voiceHints, copyRules,
#    guidance, and a one-line summary per donor slide.
#    Needs Copilot auth for the LLM pass (previews are pure-JS, no extra deps).

# 2. Shallow — OOXML extraction only (no LLM, fast)
deckpilot template create acme --from ~/AcmeBrand.pptx --shallow
#    Same master / paletteSamples / donorGeometry as above; voice / copy /
#    guidance left empty for you to fill in.

# 3. Blank scaffold to hand-edit
deckpilot template create personal
```

Bounded extraction for huge source decks: `--max-donor-slides 12`,
`--no-donor-geometry`, `--no-master`, `--no-palette-samples`.

### Use a template

```bash
deckpilot start client-deck --template acme       # CLI flag
# or pick from the startup TUI list, or run `/template acme` mid-session
```

When the template carries a `master`, the renderer calls pptxgenjs's
`defineSlideMaster` once and references it from every slide — the logo,
background, and footer chrome are composed by PowerPoint at display time
and appear on every slide automatically. The code-gen LLM is told not to
redraw them. The `paletteSamples` and `donorGeometry` show up in the LLM's
system prompt as the "working palette" and "source layout vocabulary" —
the LLM picks colours and starting layouts from them instead of inventing.

The template's optional `voiceHints` / `copyRules` / `guidance` text is folded into the system prompt as binding guidance.

### Manage templates

```bash
deckpilot template list
deckpilot template show acme                     # shows master, paletteSamples, donorGeometry, ...
deckpilot template edit acme --set brand='Acme Corp'
deckpilot template edit acme --set "donorGeometry[0].summary=Cover with photo bg + title bottom-left"
deckpilot template edit acme --editor            # open template.json in $EDITOR / notepad
deckpilot template export acme ./acme.zip        # share with a teammate
deckpilot template import ./acme.zip --name acme-fork
deckpilot template delete acme --yes
```

…or use the **Manage templates** entry in the main menu (browse, show, create blank, import from `.pptx`, delete — all keyboard-driven).

---

## Skills: staged AI instructions

A **skill** steers *how* the AI builds the deck, at three points in the workflow:
`intake` (interview you before designing), `slide-check` (per-slide quality
bars), and `final-review` (a whole-deck pass before saving). Where a template is
visual style, a skill is process. Skills live at `~/.deckpilot/skills/<name>/SKILL.md`
and follow an agent-skills-style format (frontmatter + one section per stage).

DeckPilot ships a built-in **`story-arc`** skill that interviews you about
audience, the change you want, and the core tension — then structures the deck
as a narrative (setup → tension → turn → resolution → call to action) and
reviews it for that shape at the end.

```bash
deckpilot skill list                  # built-ins + your own
deckpilot skill show story-arc
deckpilot skill create exec-review    # writes an annotated SKILL.md to edit
deckpilot skill edit exec-review      # $EDITOR, re-validated on save
deckpilot skill delete exec-review --yes

deckpilot start --skill story-arc     # or pick one in the New-deck wizard / startup picker
deckpilot config set skill story-arc  # make it the default
```

Pick a skill as the third step of the **New deck** wizard, or manage them from
the **Manage skills** main-menu entry. Full format reference and authoring guide:
[`docs/SKILLS.md`](docs/SKILLS.md).

---

## Inside the chat

Anything you type that doesn't start with `/` is sent to the model. Slash commands are handled locally.

**Autocomplete the commands:** start a line with `/` and an autocomplete dropdown opens with every command, its argument hint, and a one-line description — filtered as you type (`/te` narrows to `/template`/`/templates`). `↑`/`↓` move the highlight, **Tab** completes the name into the prompt, **Enter** runs a no-argument command immediately (or fills in `/render `, `/template `, … and waits for the argument), and **Esc** dismisses the menu without clearing what you typed. You never have to memorize the list below.

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
| `/image`, `/img` | Attach image files as visual references the model can see (multi-select) |
| `/doc`, `/docs` | Attach document files (`.txt`/`.md`/`.pptx`/`.docx`) as text context (multi-select) |
| `/undo` | Roll back the most recent deck change |
| `/clear` | Reset the on-screen transcript (deck preserved) |
| `/new` | Clear the transcript and decouple from the current project |
| `/model`, `/models` | Inspect or switch the active model |
| `/quit`, `/exit` | Return to the main menu |

**Add files to the context with `@`:** type `@` at the start of a word to open a paged popup of **every file in your working directory**, newest-first — five at a time, with a **Show more…** row that cycles pages (`page X/Y`) and a **Type a path…** row at the end for any file *outside* this folder. Type after the `@` to filter; `↑`/`↓` navigate; **Enter** inserts the highlighted file's path right into the prompt (or, on **Type a path…**, lets you type a full absolute/relative path); **Esc** backs out. The inserted path goes to the model as part of your message, so you can reference a file by name in plain chat ("rework the flow in `@last-deck.brief.json`") or feed it to a command (`/template @brand.pptx`, `/load @last-deck.brief.json`). `@` is for *referencing a path*; to pull a file's **contents** into the conversation use the attachment commands instead — `/doc` extracts a document's text as context, and `/image` attaches pictures the model can actually see (both stage in a tray above the prompt and ride along with your next message).

**Footer tips:** the two dim lines under the prompt are a cheat-sheet — a fixed row of key hints (`/ commands · @ files · ⏎ send · …`) and a rotating `💡 Tip:` line that surfaces a different feature every few seconds.

**Editing the prompt:** the input is a rounded box with a movable caret — `←`/`→` and `Ctrl+A`/`Ctrl+E` to move, `Backspace`/`Delete` to edit at the caret. End a line with `\` then **Enter** (or **Shift+Enter** where your terminal supports it) to write a multi-line message; **Enter** alone submits. See [`docs/CLI-REFERENCE.md`](./docs/CLI-REFERENCE.md#in-chat-editing--keyboard) for the full key list.

**Cancelling:** **Esc** or **Ctrl+C** while a response is streaming aborts the generation but keeps the session alive. A second **Ctrl+C** within ~1s returns to the main menu.

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

See `docs/CLI-REFERENCE.md` for the long-form reference (every flag,
every config key, examples). The map:

```bash
deckpilot                            # open the TUI menu
deckpilot start [<name>]             # start a new deck (alias: chat)
deckpilot transform --original <a.pptx> --target <b.pptx> [<name>]   # restyle a deck's content into another deck's look (1:1)
deckpilot improve --source <pptx> --template <name> [--skill <s>] [<name>]   # quality-check a deck and rebuild a better version
deckpilot resume <name>              # resume a saved project with full LLM memory
deckpilot render <brief.json>        # headless render (CI, scripting)

# Projects — saved chats with autosaved brief + slide code + transcript
deckpilot project list
deckpilot project show <name>
deckpilot project rename <old> <new>
deckpilot project export <name> [<zip>]
deckpilot project delete <name> [<name> ...] --yes      # bulk-delete

# Templates — reusable brand specs (theme + master + voice/copy/guidance)
deckpilot template list
deckpilot template show <name>
deckpilot template create <name> [--from <pptx>] [--shallow]
deckpilot template edit <name> [--set k=v ...] [--editor]
deckpilot template export <name> [<zip>]
deckpilot template import <zip> [--name <new>]
deckpilot template delete <name> [<name> ...] --yes

# Skills — staged AI instructions (intake / slide-check / final-review)
deckpilot skill list
deckpilot skill show <name>
deckpilot skill create <name> [--overwrite]
deckpilot skill edit <name>
deckpilot skill delete <name> [<name> ...] --yes

# Persistent defaults at ~/.deckpilot/config.json
deckpilot config list
deckpilot config get|set|unset <key>

# Auth + diagnostics
deckpilot auth status|login|logout
deckpilot doctor                     # Node version, Copilot SDK, preview renderer, $EDITOR
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
- ✅ **v0.12** — **Vision-driven brand extraction** (`template create --from brand.pptx`). Trust-UX sweep: visible tool errors, clickable preview file links, autosave indicator, auth-error banner.
- ✅ **v0.13** — Bundled DesignSystem presets, expanded glyph set, DECKPILOT.md per-directory style guide.
- ✅ **v0.14** — Native **Windows support** (`install.ps1`), corporate-proxy-safe zip-download bootstrap, cross-platform-binding rule across the codebase, PowerShell 5.1 compatibility.
- ✅ **v0.15** — Persistent CLI defaults (`deckpilot config`), **full TUI ↔ CLI parity**: every menu action has a CLI sibling (`template edit/export/import`, `project rename/export`, bulk-delete via varargs). In-TUI template editor with `/` search, multi-select, breadcrumbs, spinners. Comprehensive `docs/CLI-REFERENCE.md`. `save_deck` no longer clutters the working directory.
- ✅ **v0.16** — Faithful brand reproduction. `template create --from <pptx>` extracts the source's brand **master** (background + logo + footer chrome), **paletteSamples** (working palette across all slides), and **donorGeometry** (per-slide layout vocabulary). The renderer applies the master via pptxgenjs's `defineSlideMaster` so every generated slide inherits brand chrome automatically — the code-gen LLM never redraws the logo. Unified create wizard in the TUI; `--no-master` / `--no-donor-geometry` / `--max-donor-slides` flags for control.
- ✅ **v0.17** — Deeper donor extraction. `template create --from <pptx>` now also pulls the title slide's full-bleed **cover background** (resolved through slide → layout → title/section-header layouts, deduped against the master background) into `assets/cover-background.*`, and the donor's **full theme palette** (`themePalette` — all six accents + dark/light + hyperlink colours from `theme1.xml`'s `clrScheme`) alongside `paletteSamples`. `theme.assets` is now actually threaded onto the frozen theme the slide code sees, so the code-gen LLM can paint the cover background on covers/dividers. New `--no-cover-background` opt-out for the shallow path.
- ✅ **v0.18** — **Two background patterns, applied by slide role.** Extraction now captures a distinct **content background** (`master.background`) alongside the **cover background** (`master.coverBackground`): the content background is the body slides' inherited canvas — an image when the donor has one, else a solid fill in the deck's paper colour. Briefs carry a per-slide `role` (`cover` / `divider` / `content`); the renderer applies the cover background to cover + section-divider slides and the content background to the rest **deterministically** (no longer reliant on the LLM painting it). New `--no-content-background` opt-out for the shallow path.
- ✅ **v0.19** — **Visual reference images.** Type `/image` (or `/img`) in the chat to open a multi-select picker of image files in the working folder (png/jpg/gif/webp); chosen images stage in a tray above the prompt and attach to your next message as a multimodal turn the model can see — so you can say "match this style" or "rebuild this chart" with the picture attached. Multiple images per turn (cap 8, ≤ 5 MB each); attachments are copied into the project and recorded in the transcript so a resumed session shows them.
- ✅ **v0.20** — **Document context.** Type `/doc` (or `/docs`) in the chat to attach reference documents — `.txt`, `.md`, `.pptx`, `.docx` (e.g. an SoW or a reference deck). Their text is extracted (slides + speaker notes for `.pptx`; paragraphs + tables for `.docx`) and injected as reference context with your next message, persisting in the conversation for the rest of the session. Multi-select tray alongside `/image`; generous size caps (~60k chars/doc, ~150k total) with truncation; copied into the project's `context/` dir and recorded in the transcript.
- ✅ **v0.21** — **Pure-JS previews — LibreOffice + poppler removed.** Slide rasterization (the visual critique loop and vision-driven `template create --from <pptx>`) now runs in-process via [`pptx-glimpse`](https://github.com/hirokisakabe/pptx-glimpse), a bundled npm dependency. A fresh install needs **no external binaries** — the installer no longer probes for or offers to install `soffice`/`pdftoppm`, and `doctor` reports the pure-JS renderer. Footprint drops from ~500 MB of system packages to a ~30 MB dependency, with identical behaviour on Windows and Linux. Requires **Node ≥ 22**. Previews substitute fonts they can't find locally (the generated `.pptx` is unaffected). Also fixes 4:3 deck rendering (the layout name was wrong) and gives tables a sensible default row height so they lay out correctly in the preview.
- ✅ **v0.22** — **Claude-Code-style chat UI.** The chat REPL was reworked to feel like a modern agent CLI. Finalized transcript entries are committed once to the terminal's **native scrollback** via ink's `<Static>` (only the live region — the streaming reply, in-flight tool, prompt, status — re-renders), so long sessions stay fast and scroll naturally; a `<Static>` remount on `/clear` keeps the scrollback honest. Messages adopt Claude-Code markers: user input as a dim `>` line, assistant replies led by a `⏺` bullet, and tool calls as `⏺ Label` with results on a `⎿` tree line (dim while running, red on error). The prompt is a rounded input box with a real **movable block caret** (←/→, Ctrl+A/E, Backspace/Delete at the caret) and **multi-line editing** (`\` + Enter, or Shift+Enter where the terminal reports it; pastes with newlines stay literal); **Esc** interrupts an in-flight generation. The `@`/`/image`/`/doc` pickers now anchor at the caret, and the menu text inputs share the same caret rendering. A one-time welcome banner opens the session. **Home screen** redesigned to match (v0.22.2): an ASCII wordmark + tagline, a workspace/projects info box, and a clean single-column menu with a `❯` cursor (the old two-column layout could overlap and wrap on narrow windows).
- ✅ **v0.23** — **Transform a deck.** Reproduce an **original** deck's content in a **target** deck's visual style — "same content, new client." `deckpilot transform --original a.pptx --target b.pptx` (or **Transform a deck** in the TUI menu) loads the target as a one-shot style template (palette, fonts, master/brand chrome) and seeds the agent with the original's full extracted text **plus** a `study_original_slides` vision pass so it sees every source slide. It then reproduces the content **1:1** — same slide count and order, same titles/bullets/tables, the same speaker notes — pausing at the proposed brief for your **"build"** approval before auto-building each slide through the normal critique loop, then leaves the chat open for adjustments. Resumes restore the target style + study tool from the project manifest. Strict-1:1 needs a ≤40-slide original (the deck-brief cap); larger decks fail fast with a clear message. Composes the existing pipeline — no second renderer or parallel path.
- ✅ **v1.0.0** — **First stable release.** Marks the create → transform → improve workflow as complete and stable: conversational deck authoring, brand-template extraction/reuse, staged skills, persistent resumable projects, pure-JS previews (no system packages), and full TUI ↔ CLI parity. The headline capability of this release is **Improve a deck** — quality-check an existing deck and rebuild a better version. `deckpilot improve --source deck.pptx --template <name>` (optionally `--skill <name>`), or **Improve a deck** in the TUI menu. The source is seeded as content — full extracted text **plus** a `study_source_slides` vision pass so the agent sees how every slide currently looks — and the chosen **named template** (required) supplies the rebuilt deck's style. Unlike transform's strict 1:1, improve is a **rewrite**: the agent first calls `save_improvement_plan` to write a candid assessment (overall strengths/weaknesses + per-slide recommendations) to `IMPROVEMENT-PLAN.md` in the project, then proposes a rebuilt brief — it may sharpen titles, tighten bullets, restructure flow, enrich speaker notes, and redesign layouts for clear visual hierarchy — preserving the source's facts and intent while improving the expression. It pauses at the proposed brief for your **"build"** approval before auto-building through the normal critique loop, then stays open for chat. Resumes restore the source + study/plan tools from the project manifest. Composes the existing pipeline — no second renderer or parallel path.
- ✅ **v1.1.0** — **First-run Copilot readiness check.** The very first time you open the TUI (`deckpilot` with no args), DeckPilot now gates on a quick **readiness screen** before the menu: it confirms a GitHub token is resolvable (env var or the Copilot CLI keychain) and then **pings the Copilot SDK** — a successful pong proves you're signed in, Copilot-entitled, and the service is reachable. If anything's off it shows one clear next step (`deckpilot auth login`) with **r recheck · c continue anyway · q quit**; on success it advances to the menu and records the result so later launches start instantly (an expired credential is still caught at chat start by the existing auth banner). The probe is shared with `deckpilot doctor`, so the CLI and TUI report the same checks and never drift.
- ✅ **v1.2.0** — **Doctor in the TUI menu.** The preflight diagnostics that used to live only behind `deckpilot doctor` are now a first-class menu entry — pick **Doctor** (`d`) from the home screen to run them without leaving the TUI. The screen runs the exact same checks as the CLI command (Node ≥ 22, GitHub token resolvable, cwd writable, Copilot SDK reachable, and the visual-critique preview pipeline), shows a green/yellow/red line per check with a fix hint on any failure, and offers **r recheck · b/Esc back**. Both surfaces share one `runDoctorChecks()` implementation so the CLI and TUI never drift.
- ✅ **v1.2.2** — **Windows preview fix.** Slide previews failed on stock Windows because the pure-JS rasteriser's font shaper (opentype.js) throws on GSUB *lookupType 7* tables, which every default Windows font (Calibri, Arial, Cambria, Segoe UI, Carlito) carries — so every preview returned `preview_unavailable` even though the generated `.pptx` was perfect. Fixed two ways: DeckPilot now **bundles opentype.js-safe fonts** (Noto Sans / Noto Serif) and routes the common brand/system fonts to them, retrying with the OS font scan disabled if a render still trips; and a small **patched opentype.js** (via `patch-package`) skips an unsupported font feature instead of aborting the whole render. The preview pipeline also **short-circuits after the first infrastructure failure** in a session (no more re-running the slow failing render per slide) and tells the model it's an environment issue so it keeps building. Previews are approximate substitutes — the saved `.pptx` always carries the real fonts.
- ✅ **v1.2.3** — **Paged deck picker for Transform & Improve.** The file picker that starts **Transform a deck** and **Improve a deck** now lists the workspace's `.pptx` files **newest-first, five at a time**. When there are more than five, a **Show more…** row pages through the rest (replacing the current five and cycling back to the first page after the last, with a `page X/Y` indicator); the **Type a path…** manual-entry row always sits at the end. The two flows now share one picker component instead of duplicating it.
- ✅ **v1.3.0** — **Discoverable chat commands.** Typing `/` in the chat now opens a live **autocomplete dropdown** — every slash command with its argument hint and a one-line description, filtered as you type. `↑`/`↓` highlight, **Tab** completes the name, **Enter** runs a no-argument command immediately (or fills in `/render `, `/template `, … and waits for the argument), and **Esc** dismisses it without clearing your text. The prompt footer gained a second line: a fixed **key-hints** row (`/ commands · @ files · ⏎ send · …`) plus a rotating **`💡 Tip:`** line that teaches a different feature every few seconds — so the command surface is learnable without leaving the chat. Command metadata now lives in one registry (`src/chat/slash.ts`) that drives the dropdown, the tips, and `/help` so they can't drift apart.
- ✅ **v1.3.1** — **Paged `@` file picker.** The chat's `@` picker now autocompletes **every file in the working folder** (not just decks/data), newest-first and **five at a time** — mirroring the Transform/Improve deck picker. A **Show more…** row cycles through pages (`page X/Y`, wrapping back to the first after the last), and a **Type a path…** row at the end accepts a free-form absolute/relative path so you can reference a file *outside* the folder. Typing after `@` filters the list (and resets to page 1); `↑`/`↓` navigate; **Enter** inserts the highlighted path or opens path-entry; **Esc** backs out. The paging math is a shared `pickerLayout()` helper in `src/util/files.ts`; the `/image` and `/doc` multi-select pickers are unchanged.
- ✅ **v1.3.2 (current)** — **Slash-menu highlight fix.** The `/` autocomplete dropdown's selected row used an invalid colour (`cyanBright` + `Bright` → `cyanBrightBright`), which ink silently drops — so the highlight never rendered. The selected `›` row now shows in the proper bright-cyan accent.

## License

MIT — see [LICENSE](./LICENSE).
