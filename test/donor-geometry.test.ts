import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractDonorGeometry } from '../src/template/donor-geometry.js';
import { readThemeSchemeMap } from '../src/template/palette-aggregate.js';

const FIXTURE = join(process.cwd(), 'test/fixtures/sample-branded.pptx');

async function openFixture(): Promise<JSZip> {
  const buf = readFileSync(FIXTURE);
  return JSZip.loadAsync(buf);
}

describe('extractDonorGeometry — sample-branded.pptx fixture', () => {
  it('returns exactly 3 donor entries (one per slide)', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    expect(donors.length).toBe(3);
    expect(donors.map((d) => d.index)).toEqual([0, 1, 2]);
  });

  it('captures the layout name for each donor', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    // All three slides use the same BrandMaster layout in the fixture.
    expect(donors[0].layoutName).toBe('BrandMaster');
    expect(donors[1].layoutName).toBe('BrandMaster');
    expect(donors[2].layoutName).toBe('BrandMaster');
  });

  it('extracts named text shapes with their content + style on slide 1', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    const cover = donors[0];
    const shapeNames = cover.shapes.map((s) => s.name);
    expect(shapeNames).toContain('Title');
    expect(shapeNames).toContain('Subtitle');
    const title = cover.shapes.find((s) => s.name === 'Title');
    expect(title?.kind).toBe('text');
    expect(title?.sampleText?.toLowerCase()).toContain('knowledge');
    expect(title?.fontSize).toBe(60);
    expect(title?.bold).toBe(true);
    expect(title?.textColor).toBe('FFFFFF');
  });

  it('sorts shapes by area (largest first) within each donor', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    for (const d of donors) {
      const areas = d.shapes.map((s) => s.w * s.h);
      for (let i = 1; i < areas.length; i++) {
        expect(areas[i - 1]).toBeGreaterThanOrEqual(areas[i]);
      }
    }
  });

  it('truncates the shape array to maxShapesPerSlide (default 6)', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    for (const d of donors) {
      expect(d.shapes.length).toBeLessThanOrEqual(6);
    }
  });

  it('honours custom maxShapesPerSlide for tighter token budgets', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme, { maxShapesPerSlide: 2 });
    for (const d of donors) {
      expect(d.shapes.length).toBeLessThanOrEqual(2);
    }
  });

  it('honours maxSlides to bound the donor list size', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme, { maxSlides: 2 });
    expect(donors.length).toBe(2);
  });

  it('captures named card rects on the six-card slide (slide 3)', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    // The fixture's slide 3 emits 6 named card rects + 6 card titles + 1
    // slide title = 13 shapes total. With the default cap of 6, we keep
    // the largest 6 by area. Card rects (3.7 × 2.4 ≈ 8.88) win over the
    // text labels (3.2 × 0.5 ≈ 1.6) and the slide title (11 × 0.9 ≈ 9.9).
    const donors = await extractDonorGeometry(zip, scheme);
    const cards = donors[2];
    const cardBgs = cards.shapes.filter((s) => s.name.startsWith('CardBg'));
    expect(cardBgs.length).toBeGreaterThan(0);
    for (const c of cardBgs) {
      expect(c.fillColor).toBeDefined();
    }
  });

  it('default summary is empty string until vision pass authors it', async () => {
    const zip = await openFixture();
    const scheme = await readThemeSchemeMap(zip);
    const donors = await extractDonorGeometry(zip, scheme);
    for (const d of donors) {
      expect(d.summary).toBe('');
    }
  });
});
