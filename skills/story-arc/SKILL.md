---
name: story-arc
description: Shapes the deck as a narrative arc — setup, tension, turn, resolution — and interviews the user first.
version: 1.0
stages: [intake, slide-check, final-review]
---

## intake
Design this deck as a STORY ARC, not a list of topics.

First, interview the user. Ask 3-5 focused questions and WAIT for answers before
you call propose_deck_brief (unless the user says "skip the questions"):
1. Who is the audience, and what do they believe or feel right now (the starting state)?
2. What single change in belief or action should they leave with (the resolution)?
3. What is the core tension or stakes — the problem, gap, or risk that makes this matter?
4. What is the strongest proof for the turn (data, a story, a demo)?
5. What is the one thing they must remember if they forget everything else?

Then structure the outline along an arc, and say in the brief which slide plays which role:
- HOOK / SETUP — establish the audience's world and what's at stake.
- TENSION — sharpen the problem; make the gap feel urgent.
- TURN — introduce the insight, solution, or reframe.
- RESOLUTION — show the payoff with the strongest proof.
- CALL TO ACTION — the single change you want.

## slide-check
For every slide, before accepting it, verify it earns its place in the arc:
- It advances the story — name its role (hook / tension / turn / resolution / CTA). If it does none, cut or merge it.
- It carries ONE beat. No slide resolves the tension before the turn.
- Momentum: the slide makes the audience want the next one. Tension slides must not feel like a happy ending.
- The emotional temperature matches the beat (urgency in tension; relief/confidence in resolution).

## final-review
Read the whole deck as a story before save_deck:
- Is there a clear setup → tension → turn → resolution shape? Flag flat stretches with no rising tension.
- Does the opening hook within the first 1-2 slides? Does the close land the single change named in intake?
- Is there exactly one climax (the turn)? Remove competing climaxes.
- Cut or merge any slide that does not move the arc. Prefer fewer, stronger beats.

Then summarize the arc back to the user — one line per beat — and note any slide that breaks it.
