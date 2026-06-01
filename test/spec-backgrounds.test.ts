import { describe, expect, it } from 'vitest';
import { DeckBriefSchema, SlideBriefSchema } from '../src/deck/brief.js';
import { MasterSchema } from '../src/template/spec.js';

describe('MasterSchema.coverBackground', () => {
  it('accepts a master with only a coverBackground', () => {
    const r = MasterSchema.safeParse({
      coverBackground: { type: 'image', src: 'assets/cover-background.png' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts both a content background and a coverBackground', () => {
    const r = MasterSchema.safeParse({
      background: { type: 'solid', color: 'EEEEEE' },
      coverBackground: { type: 'image', src: 'assets/cover-background.png' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty master (no background, coverBackground, or objects)', () => {
    expect(MasterSchema.safeParse({}).success).toBe(false);
  });
});

describe('SlideBriefSchema.role', () => {
  it('accepts cover / divider / content', () => {
    for (const role of ['cover', 'divider', 'content'] as const) {
      const r = SlideBriefSchema.safeParse({ id: 'a', title: 'T', purpose: 'p.', role });
      expect(r.success).toBe(true);
    }
  });

  it('treats role as optional', () => {
    expect(SlideBriefSchema.safeParse({ id: 'a', title: 'T', purpose: 'p.' }).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(
      SlideBriefSchema.safeParse({ id: 'a', title: 'T', purpose: 'p.', role: 'hero' }).success,
    ).toBe(false);
  });

  it('round-trips roles through DeckBriefSchema', () => {
    const r = DeckBriefSchema.safeParse({
      meta: { title: 'x' },
      theme: { accent: '1A2B5E', accentAlt: 'C8202E', tone: 'editorial', aspect: '16:9' },
      slides: [
        { id: 'a', title: 'A', purpose: 'a.', role: 'cover' },
        { id: 'b', title: 'B', purpose: 'b.', role: 'content' },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.slides[0]!.role).toBe('cover');
  });
});
