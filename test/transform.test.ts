import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_TRANSFORM_SLIDES,
  TRANSFORM_SEED_PROMPT,
  countPptxSlides,
  defaultTransformProjectName,
  renderTransformGuidance,
} from '../src/chat/transform.js';

const FIXTURE = join(__dirname, 'fixtures', 'sample-branded.pptx');

describe('defaultTransformProjectName', () => {
  it('slugifies the stem and appends -transformed', () => {
    expect(defaultTransformProjectName('/x/Q3 Board Update.pptx')).toBe(
      'q3-board-update-transformed',
    );
    expect(defaultTransformProjectName('deck.pptx')).toBe('deck-transformed');
    expect(defaultTransformProjectName('Client_A Pitch.PPTX')).toBe('client-a-pitch-transformed');
  });

  it('falls back to a generic stem when the name is empty/symbolic', () => {
    expect(defaultTransformProjectName('___.pptx')).toBe('deck-transformed');
  });
});

describe('countPptxSlides', () => {
  it('counts slide parts in a real .pptx', async () => {
    expect(await countPptxSlides(FIXTURE)).toBe(3);
  });

  it('is within the transform cap', async () => {
    expect(await countPptxSlides(FIXTURE)).toBeLessThanOrEqual(MAX_TRANSFORM_SLIDES);
  });
});

describe('renderTransformGuidance', () => {
  const g = renderTransformGuidance();
  it('states the 1:1 content + target-only style contract', () => {
    expect(g).toMatch(/same order/i);
    expect(g).toMatch(/never add, drop, merge, split, or reorder/i);
    expect(g).toMatch(/speaker notes/i);
    expect(g).toMatch(/ONLY source of visual style/i);
  });
  it('mentions the study tool and keeps the approval gate', () => {
    expect(g).toContain('study_original_slides');
    expect(g).toMatch(/approval gate is not waived/i);
  });
});

describe('TRANSFORM_SEED_PROMPT', () => {
  it('directs the model to study, propose, and stop for approval', () => {
    expect(TRANSFORM_SEED_PROMPT).toContain('study_original_slides');
    expect(TRANSFORM_SEED_PROMPT).toContain('propose_deck_brief');
    expect(TRANSFORM_SEED_PROMPT).toMatch(/build/);
  });
});
