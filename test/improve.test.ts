import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMPROVE_SEED_PROMPT,
  countPptxSlides,
  defaultImproveProjectName,
  renderImproveGuidance,
} from '../src/chat/improve.js';

const FIXTURE = join(__dirname, 'fixtures', 'sample-branded.pptx');

describe('defaultImproveProjectName', () => {
  it('slugifies the stem and appends -improved', () => {
    expect(defaultImproveProjectName('/x/Q3 Board Update.pptx')).toBe('q3-board-update-improved');
    expect(defaultImproveProjectName('deck.pptx')).toBe('deck-improved');
    expect(defaultImproveProjectName('Client_A Pitch.PPTX')).toBe('client-a-pitch-improved');
  });

  it('falls back to a generic stem when the name is empty/symbolic', () => {
    expect(defaultImproveProjectName('___.pptx')).toBe('deck-improved');
  });
});

describe('countPptxSlides (re-exported)', () => {
  it('counts slide parts in a real .pptx', async () => {
    expect(await countPptxSlides(FIXTURE)).toBe(3);
  });
});

describe('renderImproveGuidance', () => {
  const g = renderImproveGuidance();
  it('frames a rewrite (not a 1:1) that improves content and design', () => {
    expect(g).toMatch(/rewrite, not a 1:1/i);
    expect(g).toMatch(/merge, split, reorder/i);
    expect(g).toMatch(/Design is a first-class requirement/i);
    expect(g).toMatch(/ONLY source of visual style/i);
  });
  it('requires the plan before the brief and keeps the approval gate', () => {
    expect(g).toContain('save_improvement_plan');
    expect(g).toContain('study_source_slides');
    expect(g).toMatch(/approval gate is not waived/i);
  });
});

describe('IMPROVE_SEED_PROMPT', () => {
  it('directs the model to study, save a plan, propose, and stop for approval', () => {
    expect(IMPROVE_SEED_PROMPT).toContain('study_source_slides');
    expect(IMPROVE_SEED_PROMPT).toContain('save_improvement_plan');
    expect(IMPROVE_SEED_PROMPT).toContain('propose_deck_brief');
    expect(IMPROVE_SEED_PROMPT).toMatch(/build/);
  });
});
