/**
 * Aggregate the actual palette a source .pptx uses across every slide, not
 * just what theme1.xml advertises. Walks each `ppt/slides/slideN.xml`,
 * harvests every `<a:srgbClr val="..."/>` and `<a:schemeClr val="...">`
 * reference, resolves scheme refs through the theme's clrScheme, de-dupes
 * near-identical hues, and returns the top N by frequency.
 *
 * Used by `template create --from <pptx>` to populate
 * `TemplateSpec.paletteSamples`, which the code-gen LLM treats as the deck's
 * "working palette" when authoring slides (instead of inventing hex codes).
 */
import { XMLParser } from 'fast-xml-parser';
import type JSZip from 'jszip';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

/**
 * Full scheme-colour map. Keys are the OOXML scheme tokens; values are 6-hex
 * strings (no leading #). Built from `ppt/theme/theme1.xml`'s `a:clrScheme`.
 *
 * `<a:schemeClr val="accent1"/>` in a slide resolves via `scheme.accent1`.
 */
export type ThemeSchemeMap = Partial<Record<SchemeKey, string>>;
export type SchemeKey =
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'dk1'
  | 'dk2'
  | 'lt1'
  | 'lt2'
  | 'hlink'
  | 'folHlink';

/** Parse the full clrScheme from theme1.xml inside an already-opened zip. */
export async function readThemeSchemeMap(zip: JSZip): Promise<ThemeSchemeMap> {
  const xml = await zip.file('ppt/theme/theme1.xml')?.async('string');
  if (!xml) return {};
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const elements = (parsed['a:theme'] as Record<string, unknown> | undefined)?.[
    'a:themeElements'
  ] as Record<string, unknown> | undefined;
  const clr = elements?.['a:clrScheme'] as Record<string, unknown> | undefined;
  if (!clr) return {};
  const keys: SchemeKey[] = [
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'dk1',
    'dk2',
    'lt1',
    'lt2',
    'hlink',
    'folHlink',
  ];
  const out: ThemeSchemeMap = {};
  for (const k of keys) {
    const hex = readColorChild(clr[`a:${k}`]);
    if (hex) out[k] = hex;
  }
  return out;
}

function readColorChild(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  const srgb = n['a:srgbClr'] as Record<string, string> | undefined;
  if (srgb?.['@_val']) return srgb['@_val'].toUpperCase();
  const sys = n['a:sysClr'] as Record<string, string> | undefined;
  if (sys?.['@_lastClr']) return sys['@_lastClr'].toUpperCase();
  return undefined;
}

/** Aggregate-palette options. Max output size capped at 12 to match the schema. */
export type AggregatePaletteOpts = {
  /** Maximum slides to walk. Defaults to all. */
  maxSlides?: number;
  /** RGB-channel delta below which two colours collapse into one. Default 5. */
  collapseDelta?: number;
  /** Maximum entries to return. Capped at 12 by the template schema. */
  maxOut?: number;
};

/**
 * Aggregate the palette across every slide in the source .pptx.
 *
 * Returns an array of 6-hex strings (no leading #), sorted by frequency
 * descending, with near-duplicates collapsed.
 */
export async function aggregatePalette(
  zip: JSZip,
  scheme: ThemeSchemeMap,
  opts: AggregatePaletteOpts = {},
): Promise<string[]> {
  const slidePaths = listSlidePaths(zip);
  const slidesToScan = opts.maxSlides ? slidePaths.slice(0, opts.maxSlides) : slidePaths;
  const collapseDelta = opts.collapseDelta ?? 5;
  const maxOut = Math.min(opts.maxOut ?? 12, 12);

  const histogram = new Map<string, number>();

  for (const path of slidesToScan) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const parsed = xmlParser.parse(xml);
    walkColors(parsed, scheme, (hex) => {
      histogram.set(hex, (histogram.get(hex) ?? 0) + 1);
    });
  }

  // Collapse near-duplicates: keep the most-frequent representative of each
  // cluster. We scan in frequency-descending order and absorb hits within
  // collapseDelta into the highest-frequency neighbour.
  const ordered = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  const kept: { hex: string; count: number; rgb: [number, number, number] }[] = [];
  for (const [hex, count] of ordered) {
    const rgb = hexToRgb(hex);
    const merge = kept.find((k) => rgbDistance(k.rgb, rgb) <= collapseDelta);
    if (merge) {
      merge.count += count;
    } else {
      kept.push({ hex, count, rgb });
    }
  }
  kept.sort((a, b) => b.count - a.count);
  return kept.slice(0, maxOut).map((k) => k.hex);
}

/**
 * List every `ppt/slides/slideN.xml`, sorted by numeric N so we iterate in
 * the file's slide order.
 */
function listSlidePaths(zip: JSZip): string[] {
  const paths = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p),
  );
  paths.sort((a, b) => {
    const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    return na - nb;
  });
  return paths;
}

/**
 * Recursively walk a parsed-XML tree, calling `onColor(hex)` for every
 * `<a:srgbClr val="HEX"/>` and every `<a:schemeClr val="accent1"/>` (resolved
 * through the scheme map).
 *
 * Exported for tests that want to feed a synthetic parsed-XML tree.
 */
export function walkColors(
  node: unknown,
  scheme: ThemeSchemeMap,
  onColor: (hex: string) => void,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkColors(item, scheme, onColor);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  // srgbClr — direct hex.
  const srgb = obj['a:srgbClr'];
  if (srgb) {
    visitColorElement(srgb, (s) => {
      const val = s['@_val'];
      if (val && /^[0-9a-fA-F]{6}$/.test(val)) onColor(val.toUpperCase());
    });
  }

  // schemeClr — needs theme resolution.
  const schemeRef = obj['a:schemeClr'];
  if (schemeRef) {
    visitColorElement(schemeRef, (s) => {
      const val = s['@_val'] as string | undefined;
      if (val && val in scheme) {
        const hex = scheme[val as SchemeKey];
        if (hex) onColor(hex);
      }
    });
  }

  // sysClr — system colour with lastClr fallback.
  const sys = obj['a:sysClr'];
  if (sys) {
    visitColorElement(sys, (s) => {
      const last = s['@_lastClr'];
      if (last && /^[0-9a-fA-F]{6}$/.test(last)) onColor(last.toUpperCase());
    });
  }

  for (const key of Object.keys(obj)) {
    if (key === '@_val' || key === '@_lastClr' || key.startsWith('@_')) continue;
    if (key === 'a:srgbClr' || key === 'a:schemeClr' || key === 'a:sysClr') continue;
    walkColors(obj[key], scheme, onColor);
  }
}

function visitColorElement(
  node: unknown,
  visit: (s: Record<string, string>) => void,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === 'object') visit(item as Record<string, string>);
    }
    return;
  }
  if (typeof node === 'object') visit(node as Record<string, string>);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
