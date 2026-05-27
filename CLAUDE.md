# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DeckPilot is a CLI tool for generating PowerPoint presentations using the GitHub Copilot SDK. Inputs include prompts, outlines, markdown, research notes, and structured data; outputs are slide decks with consistent layouts, speaker notes, themes, and reusable templates.

## Current State

The repository is at initial-commit stage. Only `README.md`, `LICENSE`, and a Node-style `.gitignore` exist — there is no source code, `package.json`, build configuration, or test setup yet. The `.gitignore` (covering `node_modules/`, `*.tsbuildinfo`, `.env`, etc.) signals a Node.js / TypeScript implementation is intended, but the toolchain has not been chosen or scaffolded.

When asked to add features, first establish the foundational layout (entry point, package manifest, CLI framework choice, GitHub Copilot SDK integration) before building feature code on top. Don't assume conventions that haven't been set — confirm framework/library choices with the user before scaffolding.

## Architectural Concerns to Surface Early

Two integration points will shape most of the codebase and should be decided deliberately rather than improvised:

1. **GitHub Copilot SDK usage** — how prompts/outlines/markdown get transformed into structured slide content (layout, speaker notes, theming) via the SDK. The boundary between "LLM produces structured plan" and "code renders deterministic PPTX" matters for testability.
2. **PowerPoint generation** — pick one library (e.g. `pptxgenjs`, `officegen`, python-pptx via subprocess) and centralize all PPTX emission behind it; layouts/themes/templates should be data, not scattered code.
