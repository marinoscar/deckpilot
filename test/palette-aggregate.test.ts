import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  type ThemeSchemeMap,
  aggregatePalette,
  readThemeSchemeMap,
  walkColors,
} from '../src/template/palette-aggregate.js';

/**
 * Build a tiny in-memory .pptx zip with one slide and a controlled
 * payload of color references. We exercise the aggregator end-to-end
 * (zip → walk → histogram → collapse → sort).
 */
async function buildZip(opts: {
  theme?: string;
  slides: string[];
}): Promise<JSZip> {
  const zip = new JSZip();
  if (opts.theme) zip.file('ppt/theme/theme1.xml', opts.theme);
  // presentation.xml just so it's a recognisable layout; aggregator doesn't read it.
  zip.file('ppt/presentation.xml', '<p:presentation/>');
  opts.slides.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
  });
  return zip;
}

const wrapSlide = (inner: string) => `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>${inner}</p:spTree></p:cSld>
</p:sld>`;

const theme = (scheme: Record<string, string>) => {
  const inner = Object.entries(scheme)
    .map(([k, hex]) => `<a:${k}><a:srgbClr val="${hex}"/></a:${k}>`)
    .join('');
  return `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="x">${inner}</a:clrScheme>
  </a:themeElements>
</a:theme>`;
};

describe('readThemeSchemeMap', () => {
  it('parses every accent/dk/lt slot present in clrScheme', async () => {
    const zip = await buildZip({
      theme: theme({
        accent1: '1A2B5E',
        accent2: 'C8202E',
        accent3: '0F62FE',
        accent4: 'F1C21B',
        dk1: '1F2328',
        lt1: 'FFFFFF',
        hlink: '0066CC',
      }),
      slides: [],
    });
    const map = await readThemeSchemeMap(zip);
    expect(map.accent1).toBe('1A2B5E');
    expect(map.accent4).toBe('F1C21B');
    expect(map.dk1).toBe('1F2328');
    expect(map.lt1).toBe('FFFFFF');
    expect(map.hlink).toBe('0066CC');
    // Not in the input — should be absent.
    expect(map.accent5).toBeUndefined();
  });

  it('returns an empty map when theme1.xml is absent', async () => {
    const zip = await buildZip({ slides: [] });
    const map = await readThemeSchemeMap(zip);
    expect(map).toEqual({});
  });
});

describe('walkColors (recursive)', () => {
  it('finds srgb colours regardless of nesting depth', () => {
    const tree = {
      'p:sld': {
        'p:cSld': {
          'p:spTree': {
            'p:sp': [
              { 'p:spPr': { 'a:solidFill': { 'a:srgbClr': { '@_val': 'AABBCC' } } } },
              {
                'p:txBody': {
                  'a:p': {
                    'a:r': {
                      'a:rPr': { 'a:solidFill': { 'a:srgbClr': { '@_val': 'DDEEFF' } } },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    };
    const found: string[] = [];
    walkColors(tree, {}, (hex) => found.push(hex));
    expect(found.sort()).toEqual(['AABBCC', 'DDEEFF']);
  });

  it('resolves schemeClr references via the scheme map', () => {
    const tree = {
      'p:sp': {
        'p:spPr': { 'a:solidFill': { 'a:schemeClr': { '@_val': 'accent3' } } },
      },
    };
    const scheme: ThemeSchemeMap = { accent3: 'F1C21B' };
    const found: string[] = [];
    walkColors(tree, scheme, (hex) => found.push(hex));
    expect(found).toEqual(['F1C21B']);
  });

  it('ignores schemeClr refs without a matching scheme entry', () => {
    const tree = { 'a:schemeClr': { '@_val': 'accent9' } };
    const found: string[] = [];
    walkColors(tree, {}, (hex) => found.push(hex));
    expect(found).toEqual([]);
  });

  it('falls back to lastClr on sysClr', () => {
    const tree = { 'a:sysClr': { '@_val': 'windowText', '@_lastClr': '000000' } };
    const found: string[] = [];
    walkColors(tree, {}, (hex) => found.push(hex));
    expect(found).toEqual(['000000']);
  });

  it('skips srgb values that arent valid 6-hex', () => {
    const tree = {
      'a:srgbClr': [{ '@_val': 'ZZZZZZ' }, { '@_val': '123' }, { '@_val': 'AABBCC' }],
    };
    const found: string[] = [];
    walkColors(tree, {}, (hex) => found.push(hex));
    expect(found).toEqual(['AABBCC']);
  });
});

describe('aggregatePalette', () => {
  it('returns top hexes sorted by frequency descending', async () => {
    const zip = await buildZip({
      slides: [
        wrapSlide(
          // 3x AABBCC, 1x DDEEFF, 2x 112233
          `<p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="DDEEFF"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>`,
        ),
        wrapSlide(
          `<p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>`,
        ),
      ],
    });
    const result = await aggregatePalette(zip, {});
    expect(result[0]).toBe('AABBCC');
    expect(result[1]).toBe('112233');
    expect(result[2]).toBe('DDEEFF');
  });

  it('collapses near-duplicates into one bucket using the dominant hex', async () => {
    const zip = await buildZip({
      slides: [
        wrapSlide(
          // AABBCC (5x) + AABBCD (1x, diff = 1) should collapse to AABBCC.
          `<p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="AABBCD"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:srgbClr val="223344"/></a:solidFill></p:spPr></p:sp>`,
        ),
      ],
    });
    const result = await aggregatePalette(zip, {});
    // AABBCD must be absorbed into AABBCC.
    expect(result).toContain('AABBCC');
    expect(result).not.toContain('AABBCD');
    expect(result).toContain('223344');
    expect(result.length).toBe(2);
  });

  it('resolves schemeClr through the supplied scheme map', async () => {
    const zip = await buildZip({
      slides: [
        wrapSlide(
          `<p:sp><p:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>
           <p:sp><p:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>`,
        ),
      ],
    });
    const result = await aggregatePalette(zip, {
      accent1: '0F62FE',
      accent2: 'F1C21B',
    });
    expect(result).toEqual(['F1C21B', '0F62FE']);
  });

  it('caps the result to 12 entries regardless of input variety', async () => {
    const distinctHexes = Array.from({ length: 30 }, (_, i) =>
      // Spread across the colour space so the de-dup pass doesn't collapse them.
      // Hue spread by changing the high nibble.
      `${i.toString(16).padStart(2, '0')}00FF`.toUpperCase(),
    );
    const xml = distinctHexes
      .map((h) => `<p:sp><p:spPr><a:solidFill><a:srgbClr val="${h}"/></a:solidFill></p:spPr></p:sp>`)
      .join('');
    const zip = await buildZip({ slides: [wrapSlide(xml)] });
    const result = await aggregatePalette(zip, {});
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it('honours maxSlides to bound work on huge decks', async () => {
    const zip = await buildZip({
      slides: [
        wrapSlide(`<p:sp><p:spPr><a:solidFill><a:srgbClr val="111111"/></a:solidFill></p:spPr></p:sp>`),
        wrapSlide(`<p:sp><p:spPr><a:solidFill><a:srgbClr val="222222"/></a:solidFill></p:spPr></p:sp>`),
        wrapSlide(`<p:sp><p:spPr><a:solidFill><a:srgbClr val="333333"/></a:solidFill></p:spPr></p:sp>`),
      ],
    });
    const result = await aggregatePalette(zip, {}, { maxSlides: 2 });
    expect(result).toContain('111111');
    expect(result).toContain('222222');
    expect(result).not.toContain('333333');
  });

  it('returns an empty array when the zip has no slides', async () => {
    const zip = await buildZip({ slides: [] });
    const result = await aggregatePalette(zip, {});
    expect(result).toEqual([]);
  });
});
