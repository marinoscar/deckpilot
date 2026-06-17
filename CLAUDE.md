# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DeckPilot is a conversational CLI that turns a terminal chat into polished PowerPoint decks, powered by the GitHub Copilot SDK. Inputs include prompts, outlines, markdown, research notes, and structured data; outputs are real `.pptx` files with consistent layouts, speaker notes, themes, and reusable brand templates.

Current version: **v1.3** (see `package.json` for the exact number; **keep this line in sync on minor/major bumps**). This is a mature, fully scaffolded TypeScript/Node project — not a greenfield repo.

## How it works (architecture)

The two integration points that shape the codebase are settled — keep changes consistent with these decisions rather than reinventing them:

1. **GitHub Copilot SDK** (`src/copilot/`) drives the conversation. `chat/session.ts` orchestrates the turn loop, `chat/system-prompt.ts` assembles the system prompt (base instructions + template voice/guidance + skills), `chat/slash.ts` handles slash commands. The LLM produces a structured plan and then **authors per-slide code**, rather than DeckPilot hard-coding layouts.
2. **PowerPoint generation is code-gen over `pptxgenjs`.** The LLM writes per-slide TypeScript against a frozen API surface (`src/render/slide-api.ts`), executed in a `vm` sandbox (`src/render/sandbox.ts`); `src/render/renderer.ts` emits the `.pptx`. Previews are rendered to PNGs with the pure-JS `pptx-glimpse` library (`src/render/pptx-to-pngs.ts`, `preview.ts`) — no LibreOffice or other external binaries — so the model can look at its output and revise. All PPTX emission stays centralized behind this path — layouts/themes/templates are **data**, not scattered code.

### Repository layout

- `src/commands/` — oclif commands (the CLI surface): `chat`, `start`, `resume`, `transform`, `improve`, `menu`, `render`, `auth`, `doctor`, `models`, `version`, plus `config/*`, `project/*`, `template/*`, `skill/*`. Running `deckpilot` with no args opens the TUI menu.
- `src/ui/` — ink/React TUI (`RootApp.tsx`, pickers, status bar, streaming message view).
- `src/template/` — brand-template extraction from donor `.pptx` files: `master-extract.ts` (slide master + cover background), `palette-aggregate.ts`, `donor-geometry.ts`, `from-pptx.ts`/`inspect.ts`/`profile.ts`. The spec + zod schema live in `src/template/spec.ts`.
- `src/store/` — persistent state under `~/.deckpilot/` (`config.json`, `templates/`, `projects/`, `skills/`) via `paths.ts`.
- `src/skill/` + bundled `skills/` — staged AI instructions (e.g. `story-arc`).
- `src/deck/`, `src/tools/`, `src/util/`, `src/cli/`, `src/config/` — brief/theme modeling, tool definitions, helpers, base command, project config.
- `bin/` — oclif entry points (`run.js`, `dev.js`). `docs/` — user-facing documentation. `test/` — vitest suites. `install.sh` / `install.ps1` — standalone installers (own `INSTALL_SCRIPT_VERSION`).

### Toolchain

- TypeScript (ESM, Node ≥22), oclif command framework, ink/React TUI, zod for schemas.
- `npm run build` (tsc) · `npm test` (vitest) · `npm run lint` / `npm run format` (biome) · `npm run dev` (tsx) · `npm run manifest` (oclif).

## Versioning & documentation maintenance

**Whenever a change adds, removes, or alters user-visible behavior, treat the documentation as part of the change — update it in the same unit of work, and bump the version when cutting a release.** Documentation drift is what made this file wrong before; don't recreate it.

**Default to a patch bump** (`1.3.0 → 1.3.1`) for *every* change — features and fixes alike. **Only bump the minor (`1.3.x → 1.4.0`) or major (`1.x → 2.0.0`) when the user explicitly asks for it** (e.g. "cut a 1.4", "this is a 2.0"). Never advance the minor or major on your own initiative; when in doubt, patch. When cutting a new version:

**Every version reference in the repo must move together — a bump is not done until they all match.** The version string lives in more places than `package.json`; missing one (especially the installer scripts) breaks the test suite or ships stale docs.

1. **`package.json`** — bump `version`. **In the same step, bump `INSTALL_SCRIPT_VERSION` in both `install.sh` and `install.ps1` to the *exact same* value** — `test/install-smoke.test.ts` and `test/install-ps-smoke.test.ts` assert these equal `package.json.version`, so a mismatch fails the suite. (These are not a separate lifecycle.)
2. **`CLAUDE.md`** — the `Current version: **vX.Y**` line near the top tracks the *minor* line, so it only changes on a minor/major bump (a patch like `1.3.0 → 1.3.1` leaves it as `v1.3`).
3. **`README.md`** — the `> **Status:** vX.Y` blockquote likewise tracks the minor line (unchanged on a patch). Always add/update the Roadmap entry to the exact new version (move `(current)` to it; describe the change concretely).
4. **`docs/CLI-REFERENCE.md`** — add/adjust any new commands or flags (with the flag table and examples).
5. **`docs/TEMPLATE_SPEC.md`** — if the `TemplateSpec` schema in `src/template/spec.ts` changed (new fields, new extraction), document the field and tag it `(vX.Y+)`.
6. **`docs/INSTALL.md` / `docs/INSTALL-WINDOWS.md`** — update the sample installer-output banner (`DeckPilot installer vX.Y.Z`) in both files to the new version. Update the surrounding install/bootstrap *prose* only if that behavior actually changed.
7. Keep version tags inside docs (`(v0.16+)`, etc.) accurate, and ensure the README's feature claims match what the code actually delivers.
8. **Final sweep** — after bumping, grep for the *old* version and reconcile every remaining hit: `grep -rn "<old-version>" README.md docs/ CLAUDE.md package.json install.sh install.ps1`. The bump is done only when this returns nothing unexpected (historical Roadmap entries naturally keep their own version).

When asked to "update the docs for the new version," the source of truth is the **code and the latest commits** — diff what changed since the last version bump (`git log <last-bump>..HEAD`), then reconcile the files above against it.

## Conventions

- Match the surrounding code's style; run `npm run lint` and `npm test` before considering a change done.
- Templates, themes, and layouts are data — extend the schema in `src/template/spec.ts` and the extractors rather than hard-coding visuals in render code.
- Don't add a second PPTX library or a parallel rendering path; everything goes through the `slide-api` → `sandbox` → `renderer` pipeline.
