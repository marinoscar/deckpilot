# DeckPilot Template Specification

A **template** in DeckPilot is a hand-editable, persistent style configuration
the LLM honours when generating decks. Templates live under
`~/.deckpilot/templates/<name>/` and are made of two pieces:

```
~/.deckpilot/templates/acme-corp/
  template.json    # the TemplateSpec (this document)
  assets/          # optional logo / wordmark / background images
    logo.png
    wordmark.svg
```

The `<name>` is the directory name. It must match `template.json`'s `name`
field and follow lower-case kebab rules (`[a-z0-9-]+`).

## Three ways to create a template

```bash
# 1. From an existing .pptx — extracts palette / fonts / aspect; logos and
#    voice/copy fields are left blank for you to fill in.
deckpilot template create acme-corp --from ./brand.pptx

# 2. From scratch — drops a blank scaffold with safe defaults; edit by hand.
deckpilot template create personal

# 3. In chat — ask the LLM to author one, e.g. "create a luxe black-and-gold
#    template for jewellery brands and save it as `luxe-jewellery`". It
#    calls the `save_template` tool internally.
```

To use a template in a chat: `deckpilot chat my-deck --template acme-corp`
(or pick it from the startup TUI list, or run `/template acme-corp`
mid-session).

To share a template: zip the directory, send it, recipient unzips into their
`~/.deckpilot/templates/`. No registry, no server, no internet required.

## The TemplateSpec

### Top-level

| Field           | Type                  | Required | Description |
|-----------------|----------------------|----------|-------------|
| `schemaVersion` | `"1.0"`              | yes (default `"1.0"`) | Bumped on breaking shape changes. |
| `name`          | `string` (kebab)     | yes      | Must match the directory name. 1–64 chars. |
| `description`   | `string` ≤160        | no       | One-line summary shown in the picker. |
| `brand`         | `string` ≤160        | no       | Free-form brand name. |
| `theme`         | `Theme`              | yes      | Palette + fonts + tone + aspect. See below. |
| `assets`        | `Assets`             | no       | Logo / wordmark / background image references. |
| `voiceHints`    | `string` ≤1024       | no       | 1-3 sentences nudging copy voice. Appended verbatim to the LLM's system prompt. |
| `copyRules`     | `string` ≤2048       | no       | Bullet list of must/never rules. Appended verbatim. |
| `guidance`      | `string` ≤4096       | no       | Long-form style guidance (composition habits, taboos, references). Appended verbatim. |

### `theme`

| Field         | Type                                 | Required | Description |
|---------------|--------------------------------------|----------|-------------|
| `accent`      | 6-digit hex, no `#`                  | yes      | Primary brand color. |
| `accentAlt`   | 6-digit hex                          | yes      | Secondary, complementary. Never twin the primary. |
| `ink`         | 6-digit hex (default `1F2328`)       | no       | Body text — near-black, easier on eyes than `#000`. |
| `muted`       | 6-digit hex (default `6E7781`)       | no       | Captions, dividers, page numbers. |
| `paper`       | 6-digit hex (default `FFFFFF`)       | no       | Slide background. |
| `fontHeading` | string (default `Inter Tight`)       | no       | Heading typeface name. Must be installed where the deck is opened, or PowerPoint will fall back. |
| `fontBody`    | string (default `Inter`)             | no       | Body typeface name. |
| `tone`        | one of `editorial`, `minimal`, `corporate`, `energetic`, `studious`, `playful`, `luxe` | no | Voice hint. Shapes the LLM's word choice; does not pick layouts. |
| `aspect`      | `"16:9"` or `"4:3"` (default `16:9`) | no       | Slide canvas aspect. |

### `assets`

All paths are **relative to the template directory**. Each is optional. Paths
that escape via `..` or start with `/` are rejected. Paths pointing to files
that don't exist on disk are silently dropped on load (so a half-removed
logo doesn't break a deck render).

| Field         | Type                  | Description |
|---------------|-----------------------|-------------|
| `logo`        | relative path string  | Primary brand mark. E.g. `"assets/logo.png"`. |
| `wordmark`    | relative path string  | Wordmark / type lockup, if separate from the logo. |
| `background`  | relative path string  | Optional background image used on covers or section dividers. |

Resolved at load time, the LLM's slide code sees these as absolute paths in
`theme.assets`:

```js
if (theme.assets?.logo) {
  slide.addImage({ path: theme.assets.logo, x: 0.6, y: 0.6, w: 1.2, h: 0.5 });
}
```

## How `voiceHints` / `copyRules` / `guidance` are surfaced

All three are appended to the LLM's system prompt at session start, after
DeckPilot's base instructions. The model treats them as binding, in the same
way it honours a DECKPILOT.md style guide. Combined they are capped at a few
KB so they don't crowd out the deck content from the model's context window.

- `voiceHints` — usually 1-3 sentences about voice: "Confident, declarative.
  Short sentences. No marketing puffery."
- `copyRules` — bullets of dos/don'ts: "Always capitalise `Cloud`. Never use
  `utilize`. Section titles take a trailing period."
- `guidance` — longer style notes: composition habits ("favour asymmetric
  two-column layouts"), taboos ("no drop shadows, no gradients"), references
  ("see Pentagram's 2024 annual report for the visual vocabulary").

## Example 1 — hand-written "personal pitch" template

`~/.deckpilot/templates/personal/template.json`:

```json
{
  "schemaVersion": "1.0",
  "name": "personal",
  "description": "My pitch decks — editorial, restrained.",
  "theme": {
    "accent": "14532D",
    "accentAlt": "A16207",
    "ink": "1C1917",
    "muted": "78716C",
    "paper": "FAFAF7",
    "fontHeading": "Playfair Display",
    "fontBody": "Source Sans Pro",
    "tone": "studious",
    "aspect": "16:9"
  },
  "voiceHints": "Confident, declarative. Short sentences. No marketing puffery.",
  "copyRules": "- Always capitalise 'Cloud'.\n- Never use 'utilize'; use 'use'.\n- Section titles take a trailing period."
}
```

## Example 2 — `.pptx`-extracted "acme-corp" with a logo

Run:

```bash
deckpilot template create acme-corp --from ~/Downloads/AcmeBrand.pptx --brand "Acme Corp"
```

Then drop `logo.png` into `~/.deckpilot/templates/acme-corp/assets/` and
hand-edit `template.json` to add the asset reference + voice:

```json
{
  "schemaVersion": "1.0",
  "name": "acme-corp",
  "brand": "Acme Corp",
  "description": "Imported from AcmeBrand.pptx.",
  "theme": {
    "accent": "0F62FE",
    "accentAlt": "002D9C",
    "ink": "161616",
    "muted": "525252",
    "paper": "FFFFFF",
    "fontHeading": "IBM Plex Sans",
    "fontBody": "IBM Plex Sans",
    "tone": "corporate",
    "aspect": "16:9"
  },
  "assets": {
    "logo": "assets/logo.png"
  },
  "voiceHints": "Plainspoken, no jargon, no exclamation marks. Numbers over adjectives."
}
```

The LLM, with `theme.assets.logo` resolved to an absolute path, will place
the logo on covers and section dividers automatically.

## Validation

Every read and write goes through Zod (`src/template/spec.ts`). Common
rejections:

- `name` not lower-case kebab → "Template names must be lower-case kebab".
- Asset path containing `..` or starting with `/` → security guard.
- Color hex not exactly 6 digits → "must be a 6-digit hex string".
- `guidance` over 4096 bytes → cap exceeded.

`deckpilot template show <name>` parses + pretty-prints; use it to validate a
hand-edited template before depending on it.

## Where templates fit alongside DECKPILOT.md

| | DECKPILOT.md (per-cwd) | Named template (per-user-global) |
|---|---|---|
| Scope | Whatever deck you build in this repo/dir tree | Reusable across projects |
| Carries | Free-form markdown rules | Palette, fonts, tone, logos, voice/copy/guidance |
| Lives at | `<repo>/DECKPILOT.md` | `~/.deckpilot/templates/<name>/` |
| Loaded | Auto, every chat in this tree | Explicit (`--template <name>`, picker, or `/template <name>`) |

Both can be active simultaneously. The template provides the palette + fonts
+ assets; DECKPILOT.md adds project-local overrides like "this quarter's
decks use a 5-slide format".
