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

## Four ways to create a template

```bash
# 1. Vision-driven from an existing .pptx (recommended; default for --from)
#    The LLM renders every slide of the source deck, looks at them via
#    vision, and authors a rich TemplateSpec — palette, fonts, tone, voice,
#    copyRules, plus a dense `guidance` field with quoted observations
#    ("covers are full-bleed photography with a single-line title
#    bottom-left in 56pt geometric sans"). Needs LibreOffice + Copilot auth.
deckpilot template create acme-corp --from ./brand.pptx

# 2. Shallow OOXML-only extraction from a .pptx
#    Reads theme1.xml only — palette + fonts. Faster, no LLM call, but
#    voiceHints / copyRules / guidance are left empty for you to fill in.
deckpilot template create acme-corp --from ./brand.pptx --shallow

# 3. Blank scaffold from scratch — drops safe defaults; edit by hand.
deckpilot template create personal

# 4. LLM-authored inside chat
#    Ask the agent: "create a luxe black-and-gold template for jewellery
#    brands and save it as `luxe-jewellery`". It calls `save_template`
#    internally with a full spec.
```

To use a template: `deckpilot start my-deck --template acme-corp` (or pick
it from the startup TUI list, or run `/template acme-corp` mid-session).

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
| `master`        | `Master`             | no       | Brand chrome (logo / footer / rail objects) + the content and cover backgrounds, applied via pptxgenjs's `defineSlideMaster`. Populated by extraction from the source `.pptx`. See "Master" below. |
| `paletteSamples`| array of 6-hex (≤12) | no       | Distinct colours used prominently across the source's slides, sorted by frequency. The code-gen LLM picks from this list for cards / chart series instead of inventing hexes. |
| `themePalette`  | `ThemePalette`       | no       | The source's canonical theme colour scheme (`theme1.xml` `clrScheme`) — the named brand swatches PowerPoint shows in its colour picker. See "themePalette" below. |
| `donorGeometry` | array of `Donor` (≤40)| no      | Per-source-slide layout descriptors. The code-gen LLM sees these as the source deck's layout vocabulary. See "Donor geometry" below. |

### `master` (v0.16+)

When extraction populates `master`, the renderer calls
`pres.defineSlideMaster({ title: 'TemplateMaster', background, objects })`
once and uses `addSlide({ masterName: 'TemplateMaster' })` for every slide.
PowerPoint composes the master with the slide at display time, so the
master's background + objects appear on every generated slide automatically
— the code-gen LLM never has to redraw them.

| Field | Type | Description |
| --- | --- | --- |
| `background.type` | `'solid'` or `'image'` | **Content / all-slides background** — what body slides inherit. `solid.color` is a 6-hex; `image.src` is a path relative to the template dir. |
| `coverBackground` | `{ type: 'solid' \| 'image' }` | **Cover / divider background** (v0.18). Overrides `background` on cover and section-divider slides (see "Backgrounds by slide role"). Same shape as `background`. |
| `objects[*]` | discriminated union by `kind` | One per master shape. |
| `objects[*].kind` | `'image'` / `'rect'` / `'text'` | The three master object shapes we know how to deterministically extract and re-emit. |
| `objects[*].{x,y,w,h}` | numbers in inches | Position and size. |
| `objects[*].src` | relative path | `image` only. Resolved at render-time against `<rootDir>`. |
| `objects[*].fill` | 6-hex | `rect` only. |
| `objects[*].text` | string | `text` only. Plus optional `fontFace`, `fontSize`, `bold`, `color`, `align`. |

The extractor walks `ppt/slideMasters/slideMaster1.xml` first; if that has
no chrome (which is true for pptxgenjs-emitted decks), it falls back to
each `ppt/slideLayouts/slideLayoutN.xml` referenced by the master.

### Backgrounds by slide role (v0.18+)

Brand decks usually have two background patterns: a full-bleed **cover
background** for the title slide (and section dividers), and a **content
background** for body slides. The template models both and the renderer
applies them deterministically — the LLM never paints them:

- `master.background` — the **content background**. Applied to every slide via
  the slide master. Extraction resolves a representative content slide's
  effective background (slide → its layout → the master): an image when the
  deck has one, otherwise a solid fill in the deck's **paper colour**
  (`theme.paper`) so body slides still get a deliberate canvas.
- `master.coverBackground` — the **cover background**. The renderer overrides
  `background` with this on **cover** and **section-divider** slides. A slide
  counts as cover/divider when its brief `role` is `'cover'` / `'divider'`
  (and, for legacy briefs with no `role`, when it's slide 1). It's also
  mirrored to `assets.background` for backward compatibility.

If the deck has only one background (cover == content), only `background` is
set and every slide — including the cover — shares it; `coverBackground` is
omitted. Backgrounds are stretched to fill the slide, so author background
images at the slide's aspect ratio. The shallow extractor opt-out is
`--no-content-background`.

### `paletteSamples` (v0.16+)

Array of 6-hex strings (no `#`), capped at 12 entries, sorted by frequency
descending. Walks every `ppt/slides/slideN.xml` and aggregates every
`<a:srgbClr>` + theme-resolved `<a:schemeClr>` reference; near-duplicates
(Δ < 5 in any RGB channel) collapse into one bucket.

Surfaced to the code-gen LLM in the system prompt as the deck's "working
palette" — the LLM uses these hexes for category cards, chart series,
callouts, etc. instead of inventing new colours.

### `themePalette` (v0.17+)

The source deck's canonical theme colour scheme — read verbatim from
`ppt/theme/theme1.xml`'s `<a:clrScheme>`, the ~8–12 named swatches
PowerPoint exposes in its colour picker. Where `paletteSamples` is
*usage-frequency* (what the slides actually paint with), `themePalette` is
the *declared brand palette*. Both are surfaced to the code-gen LLM.

| Field | Type | Description |
| --- | --- | --- |
| `dk1` / `lt1` | 6-hex | Primary dark / light (usually text vs. background). |
| `dk2` / `lt2` | 6-hex | Secondary dark / light. |
| `accent1`–`accent6` | 6-hex | The six brand accents. The renderable `theme` (accent / accentAlt / …) maps a 5-colour subset of these; `accent4`–`accent6` live here as context. |
| `hyperlink` / `followedHyperlink` | 6-hex | Link colours. |

All fields are optional (a source may not define every slot). Hex strings
have no leading `#`.

### `donorGeometry` (v0.16+)

Array (max 40) of per-source-slide layout descriptors. Each entry:

| Field | Type | Description |
| --- | --- | --- |
| `index` | int | 0-based position in the source `.pptx`. Stable across template lifetime. |
| `name` | string | Slide name (`<p:cSld name="...">`) or `"Slide N"`. |
| `layoutName` | string | Source layout's name. |
| `summary` | string | One-line description authored by the vision pass. The code-gen LLM scans these to pick the right donor when authoring. |
| `shapes` | array (≤6) | The 6 visually heaviest shapes (by area), descending. Each has `name`, `kind`, `x`/`y`/`w`/`h` in inches, optional `placeholder`, `fontFace`, `fontSize`, `bold`, `fillColor`, `textColor`, `sampleText`. |

The code-gen LLM is told (in the system prompt) that `donorGeometry` is a
**starting library, not a constraint** — it can reproduce a donor's layout
in pptxgenjs code or invent its own. The donor summaries are the most
important field; geometry is for fidelity.

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
| `background`  | relative path string  | Cover / section-divider background image. As of v0.17, extraction auto-populates this from the source's title slide (`assets/cover-background.*`); you can also set it by hand. |

Resolved at load time, the LLM's slide code sees these as absolute paths in
`theme.assets`. As of v0.17 this is genuinely threaded onto the frozen
`theme` the sandbox exposes (it was previously documented but dropped before
reaching slide code), so the cover background is paintable on covers and
dividers:

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
- `guidance` — longer style notes. **This is where the brand actually lives.**
  When the vision extractor authors a template, it fills this field with
  quoted, specific observations: composition habits ("favour asymmetric
  two-column layouts", "1.2\" reserved above an all-caps eyebrow on body
  slides"), taboos ("no drop shadows, no gradients"), spatial conventions
  ("titles always at y≈0.6"), brand idiosyncrasies ("photography is
  monochrome except for spot-colour fruit imagery").

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

## Example 2 — vision-extracted "acme-corp" with a logo

Run:

```bash
deckpilot template create acme-corp --from ~/Downloads/AcmeBrand.pptx --brand "Acme Corp"
```

The vision pass renders every slide of `AcmeBrand.pptx`, the LLM examines
them, and the resulting `template.json` looks something like this — palette,
fonts, voice, and a dense `guidance` field are all auto-populated:

```json
{
  "schemaVersion": "1.0",
  "name": "acme-corp",
  "brand": "Acme Corp",
  "description": "Imported from AcmeBrand.pptx — corporate, plainspoken.",
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
  "voiceHints": "Plainspoken, no jargon, no exclamation marks. Numbers over adjectives.",
  "copyRules": "- Always capitalise 'Cloud'.\n- Never use 'utilize'.\n- Headlines are sentence case with terminal periods.",
  "guidance": "Covers use a full-bleed accent-coloured panel with a single-line title bottom-left in 64pt IBM Plex Sans Bold (white). Body slides reserve the top 1.2\" empty above an 11pt tracked-out kicker in muted grey, followed by a 44pt heading. Numbers are oversized (96pt) in the accent colour with subscript units. Section dividers use a thin 2px accent-coloured rule at y=6.0. Never mix accent and accentAlt on the same element; accentAlt is reserved for one deliberate pop per slide."
}
```

To attach a logo, drop `logo.png` into `~/.deckpilot/templates/acme-corp/assets/`
and add it to `template.json` under the `assets` block (the vision pass
deliberately leaves `assets` blank — logos vary too much for the model to
infer reliably):

```json
"assets": {
  "logo": "assets/logo.png"
}
```

With `theme.assets.logo` then resolved to an absolute path, the LLM will
place the logo on covers and section dividers when authoring decks.

### Want the old behaviour?

If you'd rather skip the LLM and just extract palette + fonts from the
OOXML theme (faster, no auth needed, but voiceHints / copyRules / guidance
are left empty for you to fill in by hand):

```bash
deckpilot template create acme-corp --from ./brand.pptx --shallow
```

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
