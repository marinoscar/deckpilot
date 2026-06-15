# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DeckPilot is a conversational CLI that turns a terminal chat into polished PowerPoint decks, powered by the GitHub Copilot SDK. Inputs include prompts, outlines, markdown, research notes, and structured data; outputs are real `.pptx` files with consistent layouts, speaker notes, themes, and reusable brand templates.

Current version: **v1.0** (see `package.json` for the exact number). This is a mature, fully scaffolded TypeScript/Node project — not a greenfield repo.

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

- TypeScript (ESM, Node ≥20), oclif command framework, ink/React TUI, zod for schemas.
- `npm run build` (tsc) · `npm test` (vitest) · `npm run lint` / `npm run format` (biome) · `npm run dev` (tsx) · `npm run manifest` (oclif).

## Versioning & documentation maintenance

**Whenever a change adds, removes, or alters user-visible behavior, treat the documentation as part of the change — update it in the same unit of work, and bump the version when cutting a release.** Documentation drift is what made this file wrong before; don't recreate it.

The convention here is a **minor bump per feature set** (`0.16 → 0.17`), patch bumps for fixes (`0.14.5 → 0.14.6`). When a feature warrants a new version:

1. **`package.json`** — bump `version`.
2. **`README.md`** — update the `> **Status:** vX.Y` blockquote and add/update the Roadmap entry (move `(current)` to the new version; describe the feature concretely).
3. **`docs/CLI-REFERENCE.md`** — add/adjust any new commands or flags (with the flag table and examples).
4. **`docs/TEMPLATE_SPEC.md`** — if the `TemplateSpec` schema in `src/template/spec.ts` changed (new fields, new extraction), document the field and tag it `(vX.Y+)`.
5. **`docs/INSTALL.md` / `docs/INSTALL-WINDOWS.md`** — update only if install/bootstrap behavior changed. The installer scripts carry their **own** `INSTALL_SCRIPT_VERSION` (separate lifecycle from the package version); bump it only when the installer itself changes.
6. Keep version tags inside docs (`(v0.16+)`, etc.) accurate, and ensure the README's feature claims match what the code actually delivers.

When asked to "update the docs for the new version," the source of truth is the **code and the latest commits** — diff what changed since the last version bump (`git log <last-bump>..HEAD`), then reconcile the files above against it.

## Conventions

- Match the surrounding code's style; run `npm run lint` and `npm test` before considering a change done.
- Templates, themes, and layouts are data — extend the schema in `src/template/spec.ts` and the extractors rather than hard-coding visuals in render code.
- Don't add a second PPTX library or a parallel rendering path; everything goes through the `slide-api` → `sandbox` → `renderer` pipeline.
