# DeckPilot CLI Reference

`deckpilot` is a conversational PowerPoint generator powered by the GitHub
Copilot SDK. Every action you can perform from the menu also has a CLI
equivalent — this document is the canonical map.

> Tip: `deckpilot <command> --help` always prints the most up-to-date
> flags, args, and examples. This file is the long-form companion.

---

## Quick start

```bash
deckpilot                                    # opens the TUI menu
deckpilot start my-pitch                     # creates / resumes a project, drops into chat
deckpilot resume my-pitch                    # alias for `start <name>` on an existing project
deckpilot project list                       # lists every saved project
deckpilot template list                      # lists every saved template
deckpilot config list                        # shows persistent CLI defaults
```

---

## Commands (alphabetical)

### `deckpilot auth`

Manage GitHub Copilot authentication. Delegates to the underlying Copilot CLI
for the device-flow login.

**Subcommands**: `login`, `logout`, `status`

```bash
deckpilot auth status
deckpilot auth login
deckpilot auth logout
```

---

### `deckpilot chat`

Deprecated alias for `deckpilot start`. Kept for muscle memory; prefer
`start` going forward.

---

### `deckpilot config get <key>`

Print one DeckPilot config value, or exit 1 if the key is unset.

| Arg | Required | Description |
| --- | --- | --- |
| `key` | yes | Canonical (`defaults.model`) or alias (`model`, `critique-passes`). |

```bash
deckpilot config get model
deckpilot config get critique-passes
deckpilot config get defaults.template
```

---

### `deckpilot config list`

Show every settable DeckPilot config key, the value if set, and the path to
the config file.

```bash
deckpilot config list
```

---

### `deckpilot config set <key> <value>`

Set one DeckPilot config value, persisted at `~/.deckpilot/config.json`
(Windows: `%USERPROFILE%\.deckpilot\config.json`). Used by `start`, `chat`,
and `resume` when no CLI flag is passed.

```bash
deckpilot config set critique-passes 3
deckpilot config set model gpt-5
deckpilot config set defaults.template acme-corp
deckpilot config set skill story-arc
```

Settable keys: `defaults.critiquePassesPerSlide` (alias `critique-passes`),
`defaults.model` (`model`), `defaults.template` (`template`), `defaults.skill`
(`skill`).

---

### `deckpilot config unset <key>`

Remove one DeckPilot config value. After this, `start`/`chat`/`resume` fall
back to the built-in default for that key.

```bash
deckpilot config unset model
deckpilot config unset critique-passes
```

---

### `deckpilot doctor`

Run preflight diagnostics: Node version, Copilot SDK reachable,
authentication / entitlement, write permissions, LibreOffice / pdftoppm for
slide preview, `$EDITOR` resolution.

```bash
deckpilot doctor
```

---

### `deckpilot menu`

Open the interactive TUI menu explicitly. This is what `deckpilot` (with no
args) does, so you rarely need to type `menu`.

```bash
deckpilot menu
```

---

### `deckpilot models`

List the Copilot models DeckPilot can use, with their context windows.

```bash
deckpilot models
```

---

### `deckpilot project delete <name> [<name> ...]`

Delete one or more saved projects (brief, slide code, transcript, manifest).
Pass several names to delete in bulk in a single command — useful for
scripted cleanup.

| Flag | Description |
| --- | --- |
| `--yes` | Required confirmation. There is no undo. |

```bash
deckpilot project delete old-draft --yes
deckpilot project delete draft-1 draft-2 draft-3 --yes
```

---

### `deckpilot project export <name> [<output>]`

Pack a saved project into a portable `.zip`. Useful for archiving a finished
deck or moving a project between machines.

```bash
deckpilot project export my-pitch                       # → ./my-pitch.zip
deckpilot project export my-pitch ./archive/my-pitch.zip
```

---

### `deckpilot project list`

List every saved project under `~/.deckpilot/projects/`, newest first.

```bash
deckpilot project list
```

---

### `deckpilot project rename <from> <to>`

Rename a saved project — moves `~/.deckpilot/projects/<from>/` to `<to>/` and
updates the manifest's name. The Copilot session ID is preserved, so an LLM
session resumes seamlessly under the new name.

```bash
deckpilot project rename my-pitch q4-pitch
```

---

### `deckpilot project show <name>`

Print the project manifest (created/updated timestamps, template, model,
session ID, critique cap) and a summary of saved slides.

```bash
deckpilot project show my-pitch
```

---

### `deckpilot render <brief>`

Render a `DeckBrief` JSON file (with sibling per-slide `.ts` source files)
straight to `.pptx`, without the chat loop. Useful for CI, regression tests,
or re-rendering a previously saved deck.

```bash
deckpilot render ./my-pitch.brief.json
deckpilot render ./my-pitch.brief.json --output ./out/pitch.pptx
```

---

### `deckpilot resume <name>`

Resume a previously saved DeckPilot project. Equivalent to
`deckpilot start <name>` for an existing project.

| Flag | Description |
| --- | --- |
| `--model <id>` | Override the LLM model for this session. |
| `--token <t>` | GitHub token (overrides env). |
| `--template <t>` | Override the saved template (named or `.pptx` path). |

```bash
deckpilot resume my-pitch
deckpilot resume my-pitch --model gpt-5
```

---

### `deckpilot start [<project>]`

Primary entry point for creating a deck. Opens a chat-driven session that
produces PowerPoint, with autosaved project state under
`~/.deckpilot/projects/<slug>/`.

| Arg | Description |
| --- | --- |
| `project` | Lower-case kebab name. Resumes if it exists, creates if it doesn't. Omit to auto-name `project-N`. |

| Flag | Description |
| --- | --- |
| `--model <id>` | LLM model to use (e.g. `claude-sonnet-4.5`, `gpt-5`). Falls back to `defaults.model`. |
| `--token <t>` | GitHub token (overrides env). |
| `--template <t>` | Named template (from `~/.deckpilot/templates/`) OR path to a `.pptx` to inherit theme/fonts one-shot. Falls back to `defaults.template`. |
| `--no-picker` | Skip the startup template picker even when templates are saved. |
| `--skill <s>` | Skill to apply (staged AI instructions, from `~/.deckpilot/skills/` or a built-in like `story-arc`). Falls back to `defaults.skill`. |
| `--no-skill-picker` | Skip the startup skill picker even when skills exist. |
| `--critique-passes <n>` | How many `render_slide_preview` passes the model is allowed per slide (0 disables visual critique). Falls back to `defaults.critiquePassesPerSlide`, then 3. Max 5. |

```bash
deckpilot start
deckpilot start my-pitch
deckpilot start my-pitch --template acme-corp
deckpilot start my-pitch --skill story-arc
deckpilot start --model gpt-5 --critique-passes 5
```

---

### `deckpilot skill list | show | create | edit | delete`

Manage **skills** — staged AI instructions applied during deck creation
(`intake` before the brief, `slide-check` per slide, `final-review` before
save). Skills live at `~/.deckpilot/skills/<name>/SKILL.md`; built-ins (e.g.
`story-arc`) ship with the app and are read-only. See
[`SKILLS.md`](./SKILLS.md) for the full format and authoring guide.

| Command | Description |
| --- | --- |
| `skill list` | List built-in + user skills. |
| `skill show <name>` | Print the description and every stage section. |
| `skill create <name> [--overwrite]` | Write an annotated `SKILL.md` scaffold to edit. |
| `skill edit <name>` | Open `SKILL.md` in `$EDITOR`, re-validated on save. Built-ins are read-only. |
| `skill delete <name> [<name> ...] --yes` | Delete one or more user skills (bulk supported). Built-ins can't be deleted. |

```bash
deckpilot skill list
deckpilot skill show story-arc
deckpilot skill create exec-review
deckpilot skill edit exec-review
deckpilot skill delete exec-review --yes
```

---

### `deckpilot template create <name>`

Create a new template. Without flags, a blank scaffold is written so you can
fill in `template.json` by hand (or via `template edit`). With `--from
<pptx>`:

1. The OOXML extractor pulls the source's **brand master** (background,
   logo, footer chrome) into `template.master`, copies the media into
   `assets/`, aggregates **paletteSamples** from every slide's colours,
   and catalogs **donorGeometry** (each source slide's named-shape layout).
2. The vision-driven LLM pass then authors `description`, `brand`,
   `voiceHints`, `copyRules`, `guidance`, and a per-donor `summary`.
3. The final template's `master` is applied automatically to every slide
   DeckPilot generates from this template (via pptxgenjs's
   `defineSlideMaster`), so brand chrome appears on every slide without the
   code-gen LLM having to redraw it.

`--shallow` skips the vision pass but still runs full OOXML extraction. Note:
the `--no-master` / `--no-donor-geometry` / `--no-palette-samples` /
`--no-cover-background` opt-outs only apply to the shallow path — the
vision-driven extractor always runs full extraction. Pass `--shallow` for the
opt-outs to take effect.

| Flag | Description |
| --- | --- |
| `--from <pptx>` | Path to a source `.pptx`. |
| `--shallow` | Skip the vision LLM pass (OOXML only). |
| `--no-master` | Skip the brand-master extraction (debug / fallback for sources with complex masters). |
| `--no-donor-geometry` | Skip the per-slide donor catalog (token-budget control on huge decks). |
| `--no-palette-samples` | Skip per-slide palette aggregation (`themePalette` from theme1.xml still comes through). |
| `--no-cover-background` | Skip extracting the title slide's full-bleed cover background into `assets.background`. The all-slides master background (if any) is still extracted. |
| `--max-donor-slides <N>` | Cap donor-catalog slide count. Default 40 (schema cap). |
| `--brand <name>` | Embed a brand name in the spec. |
| `--description <text>` | Embed a one-line description. |
| `--overwrite` | Replace an existing template's JSON (assets/ left alone). |
| `--max-slides <N>` | Cap slides sent to the LLM in the vision pass. Default 20. |

```bash
deckpilot template create acme-corp --from ./brand/acme.pptx
deckpilot template create acme-corp --from ./brand/acme.pptx --shallow
deckpilot template create acme-corp --from ./brand/acme.pptx --no-master
deckpilot template create acme-corp --from ./brand/acme.pptx --shallow --max-donor-slides 12
deckpilot template create personal     # blank scaffold
```

---

### `deckpilot template delete <name> [<name> ...]`

Delete one or more saved templates (and each assets directory). Pass several
names to bulk-delete in a single command.

| Flag | Description |
| --- | --- |
| `--yes` | Required confirmation. There is no undo. |

```bash
deckpilot template delete acme-corp --yes
deckpilot template delete proto-a proto-b proto-c --yes
```

---

### `deckpilot template edit <name>`

Edit a saved template. Two modes:

- `--set key=value` (repeatable, scriptable) — non-interactive patch.
- `--editor` (or no flags) — pop out to `$EDITOR` / `$VISUAL` (Windows:
  `notepad`) on the raw `template.json` for free-form edits.

**Settable keys** (`--set`):

| Path | Notes |
| --- | --- |
| `brand` | Brand name. |
| `description` | One-line summary. |
| `voiceHints` | 1-3 sentences of voice nudges. |
| `copyRules` | Bullet list of must/never rules. |
| `guidance` | Long-form style guidance (up to 4096 chars). |
| `theme.accent` | Hex (no `#`). |
| `theme.accentAlt` | Hex. |
| `theme.ink` | Hex. |
| `theme.muted` | Hex. |
| `theme.paper` | Hex. |
| `theme.fontHeading` | Font name. |
| `theme.fontBody` | Font name. |
| `theme.tone` | One of: `editorial`, `minimal`, `corporate`, `energetic`, `studious`, `playful`, `luxe`. |
| `theme.aspect` | `16:9` or `4:3`. |
| `assets.logo` | Path relative to the template dir. |
| `assets.wordmark` | Same. |
| `assets.background` | Same. |
| `donorGeometry[N].summary` | One-line description of donor slide N. |

> `master`, `paletteSamples`, and the geometric portion of `donorGeometry`
> are populated by extraction and read-only via `--set`. To refresh them,
> re-run `template create --from <pptx> --overwrite`. The `--editor` flow
> can still edit any field by opening `template.json` directly.

```bash
deckpilot template edit acme --set brand='Acme Corp'
deckpilot template edit acme --set theme.accent=1A2B5E --set theme.tone=corporate
deckpilot template edit acme --set "donorGeometry[0].summary=Cover with photo bg + title bottom-left"
deckpilot template edit acme --editor
deckpilot template edit acme           # implies --editor
```

---

### `deckpilot template export <name> [<output>]`

Pack a template (`template.json` + `assets/`) into a portable `.zip`.
Round-trips with `template import`.

```bash
deckpilot template export acme                    # → ./acme.zip
deckpilot template export acme ./shared/acme.zip
```

---

### `deckpilot template import <archive>`

Import a template from a zip archive (produced by `template export` or
shared by a teammate).

| Flag | Description |
| --- | --- |
| `--name <new>` | Override the template name on import — useful when you already have a template of the same name. |

```bash
deckpilot template import ./acme.zip
deckpilot template import ./acme.zip --name acme-fork
```

---

### `deckpilot template list`

List every template saved under `~/.deckpilot/templates/`.

```bash
deckpilot template list
```

---

### `deckpilot template show <name>`

Print the full TemplateSpec for a saved template.

```bash
deckpilot template show acme-corp
```

---

### `deckpilot version`

Print the installed version.

```bash
deckpilot version
```

---

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DECKPILOT_HOME` | Overrides the on-disk root (default `~/.deckpilot/` or `%USERPROFILE%\.deckpilot\`). Used by tests and for keeping multiple isolated DeckPilot installs. |
| `COPILOT_GITHUB_TOKEN` | GitHub token passed to the Copilot SDK. Same as `--token`. |
| `EDITOR` / `VISUAL` | External editor for `template edit --editor` and `guidance` field editing. Falls back to `notepad` on Windows, `vi` elsewhere. `VISUAL` wins over `EDITOR`. |

---

## Config keys

Persistent CLI defaults live in `~/.deckpilot/config.json`. Managed via
`deckpilot config get/set/unset/list`.

| Canonical key | Aliases | Type | Bounds |
| --- | --- | --- | --- |
| `defaults.critiquePassesPerSlide` | `critique-passes` | integer | 0..5 |
| `defaults.model` | `model` | string | length 1..128 |
| `defaults.template` | `template` | string | lower-case kebab, 1..64 chars |

Precedence at session start: **CLI flag** > **config default** >
**built-in fallback**.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | User error: bad args, validation failure, missing project/template, refused confirmation, partial bulk-delete failure. |
| `2` | Internal error (uncaught). |

---

## On-disk layout

```
~/.deckpilot/                          (Linux / macOS)
%USERPROFILE%\.deckpilot\              (Windows)
├── config.json                        # persistent CLI defaults
├── projects/
│   └── <slug>/
│       ├── project.json               # manifest (created/updated/sessionId/template/model)
│       ├── brief.json                 # current DeckBrief
│       ├── slides/
│       │   └── <id>.slide.ts          # one file per slide with LLM-written code
│       ├── previews/                  # rendered .png previews from critique passes
│       ├── critique-usage.json        # { slideId: passesUsed }
│       └── transcript.jsonl           # append-only chat + tool transcript
└── templates/
    └── <name>/
        ├── template.json              # TemplateSpec
        └── assets/                    # logo, wordmark, background images
```

All writes use the atomic `<file>.tmp → rename` pattern so an interrupted
save never leaves a half-written manifest. Paths use the platform separator
(`/` on POSIX, `\` on Windows).

---

## Glossary

- **Project** — a persistent DeckPilot session at `~/.deckpilot/projects/<slug>/`. Includes the brief, slide source files, transcript, and Copilot session ID. Resumable.
- **Template** — a named style configuration at `~/.deckpilot/templates/<name>/`. Carries palette, fonts, voice/copy rules, guidance, asset paths. Reusable across projects.
- **Brief** — the canonical `DeckBrief` JSON: meta, theme, slides (one entry per slide with id/title/purpose/notes). The thing the LLM proposes and refines.
- **Slide code** — one LLM-written TypeScript function per slide. Each function calls a whitelisted pptxgenjs surface inside a sandbox to draw the slide.
- **Critique pass** — one round of `render_slide_preview` + visual judgement. Capped per slide; 0 disables the loop.
- **DECKPILOT.md** — optional project-local style guide auto-loaded from the cwd's nearest ancestor when starting chat.

---

## See also

- `docs/INSTALL.md` — Linux / macOS install (npm + scoop).
- `docs/INSTALL-WINDOWS.md` — Windows-specific notes (PowerShell, scoop).
- `docs/TEMPLATE_SPEC.md` — full TemplateSpec schema with field-level docs.
