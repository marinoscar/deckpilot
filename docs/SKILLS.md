# DeckPilot Skills

A **skill** is a reusable bundle of *staged instructions* that steer the AI as
it builds a deck. Where a [template](./TEMPLATE_SPEC.md) carries **visual style**
(palette, fonts, brand chrome), a skill carries **process** — the questions to
ask up front, the checks to run on each slide, and the review to do before
saving.

Skills are inspired by the "agent skills" format (a single `SKILL.md` with YAML
frontmatter and progressive disclosure): only the parts the AI needs at a given
moment are surfaced, so the deck workflow stays lean.

```
~/.deckpilot/skills/exec-review/
  SKILL.md     # frontmatter + one section per stage (this document)
  assets/      # reserved for future use
```

The `<name>` is the directory name. It must match `SKILL.md`'s `name` field and
follow lower-case kebab rules (`[a-z0-9-]+`).

## The three stages

DeckPilot builds a deck in three phases. A skill can target any subset of them;
each stage is just a `## <stage>` section in `SKILL.md`.

| Stage | Fires at | Use it for |
|---|---|---|
| `intake` | **Phase 1 — PLAN**, before the AI proposes the outline | Interviewing the user, gathering context, framing the deck before any structure exists |
| `slide-check` | **Phase 2 — BUILD**, on every slide | Per-slide quality bars (one idea per slide, every claim sourced, …) |
| `final-review` | **Phase 3 — FINAL REVIEW**, before the deck is saved | A whole-deck pass: consistency, narrative, redundant slides |

Every stage is optional. A skill that only provides `final-review` is perfectly
valid — declare just that stage and write just that section.

## How the AI consumes a skill (hybrid delivery)

DeckPilot's phases are driven by the system prompt, not by code hooks, so skills
are delivered in two ways tuned for reliability:

- The **`intake`** stage is injected into the system prompt at session start —
  Phase 1 happens immediately, so there's nothing to defer. The AI applies it
  before proposing the brief.
- The **`slide-check`** and **`final-review`** stages are pulled on demand: the
  AI calls a `load_skill_stage` tool when it enters Phase 2 and Phase 3. This
  keeps them out of the context until they're needed and lands the instructions
  *fresh* at the moment they apply.

Skill text **steers** the AI but never overrides DeckPilot's hard rules — the
brief-approval gate, the slide-code API/sandbox, and `save_deck` semantics
always win.

## SKILL.md format

```markdown
---
name: exec-review
description: Intake interview, per-slide density checks, and a final exec-readiness pass.
version: 1.0
stages: [intake, slide-check, final-review]
---

## intake
Before proposing the brief, ask the user: who is the audience, what decision
should this deck drive, and what is the one thing they must remember? Wait for
answers before calling propose_deck_brief.

## slide-check
For every slide, before accepting it:
- one idea per slide,
- every claim is sourced or clearly framed as opinion.

## final-review
Read the whole deck. Confirm consistent voice, no redundant slides, and a clear
takeaway on the closing slide.
```

Rules:

- The file **must** start with a `---` frontmatter block.
- Frontmatter is intentionally minimal — only `key: value` lines plus the inline
  `stages: [...]` array. (No nested YAML; this keeps DeckPilot dependency-free.)
- Required frontmatter: `name`, `description`, `stages`. `version` defaults to
  `1.0`.
- Every stage listed in `stages` **must** have a matching `## <stage>` section,
  and vice-versa.
- Each stage section is capped at ~4096 characters.

## Selecting a skill

A skill is chosen per deck, like a template:

- **TUI:** the "New deck" wizard's third step lists available skills (pick one or
  "No skill"). The startup picker (`deckpilot start`) also offers them.
- **CLI:** `deckpilot start --skill story-arc` (or `--no-skill-picker` to skip).
  `deckpilot improve --source <pptx> --template <name> --skill <name>` applies a
  skill to a quality-check rebuild the same way.
- **Default:** `deckpilot config set skill <name>` applies a skill whenever you
  don't pass `--skill`.

The chosen skill is recorded in the project manifest, so resuming a project
re-applies it automatically.

## Managing skills

```bash
deckpilot skill list                     # built-ins + your own
deckpilot skill show story-arc           # description + every stage section
deckpilot skill create exec-review       # writes an annotated SKILL.md to edit
deckpilot skill edit exec-review         # open SKILL.md in $EDITOR, re-validated on save
deckpilot skill delete exec-review --yes
```

…or use **Manage skills** in the main menu (browse, show, create, delete — all
keyboard-driven).

`deckpilot skill create` writes a fully annotated `SKILL.md` — the scaffold
itself documents the format, so it's the fastest way to learn by example.

## Built-in skills

DeckPilot ships read-only built-in skills. The first is **`story-arc`**, which
shapes the deck as a narrative (setup → tension → turn → resolution → CTA) and
**interviews you first** to pin down the audience, the change you want, and the
core tension before any slides are designed.

Built-ins can't be edited or deleted. To customize one, create a new skill and
paste its contents:

```bash
deckpilot skill create story-arc-mine    # then edit to taste
```

A user skill whose name matches a built-in **shadows** the built-in everywhere.

## Skills vs. templates vs. DECKPILOT.md

- **Skill** — *process*, per-deck, chosen at start ("interview me, then build a
  narrative arc, then review it").
- **Template** — *visual style*, per-user-global ("the Acme Corp brand").
- **DECKPILOT.md** — *binding style rules*, per-directory ("rules for whatever
  I'm building in this folder").

All three can be active simultaneously.
