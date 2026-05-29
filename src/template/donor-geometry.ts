/**
 * Extract per-slide layout descriptors from a source `.pptx`.
 *
 * The code-gen LLM sees this catalog as the source deck's "layout vocabulary"
 * during chat: each entry names a slide, lists its 6 visually heaviest named
 * shapes (with positions in inches + font + colour + sample text), and the
 * vision pass later authors a one-line `summary`. The LLM picks an entry
 * whose layout matches its slide's purpose, then writes pptxgenjs code that
 * reproduces or extends it.
 *
 * Output is bounded by:
 *   - `maxSlides` (default 40) on the slide list.
 *   - `maxShapesPerSlide` (default 6) on the shape array (visually heaviest,
 *     i.e. largest by area, kept first).
 */
import { XMLParser } from 'fast-xml-parser';
import type JSZip from 'jszip';
import { basename, dirname, posix } from 'node:path';
import type { DonorGeometry, DonorShape } from './spec.js';
import { type ThemeSchemeMap } from './palette-aggregate.js';

const EMU_PER_INCH = 914400;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

export type DonorGeometryOpts = {
  /** Slides to walk. Default 40 (matches the schema cap). */
  maxSlides?: number;
  /** Shapes kept per slide (descending by area). Default 6 (schema cap). */
  maxShapesPerSlide?: number;
};

/**
 * Walk every `ppt/slides/slideN.xml`, extracting a compact geometry record
 * for each. Layout names are resolved through each slide's `_rels`.
 */
export async function extractDonorGeometry(
  zip: JSZip,
  scheme: ThemeSchemeMap,
  opts: DonorGeometryOpts = {},
): Promise<DonorGeometry[]> {
  const maxSlides = opts.maxSlides ?? 40;
  const maxShapesPerSlide = opts.maxShapesPerSlide ?? 6;

  const slidePaths = listSlidePaths(zip).slice(0, maxSlides);
  const donors: DonorGeometry[] = [];

  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const root = parsed['p:sld'] as Record<string, unknown> | undefined;
    if (!root) continue;
    const cSld = root['p:cSld'] as Record<string, unknown> | undefined;
    if (!cSld) continue;

    const slideIndex = donors.length;
    const slideName = (cSld['@_name'] as string | undefined)?.trim() || `Slide ${slideIndex + 1}`;
    const layoutName = await resolveLayoutName(zip, path);

    const spTree = cSld['p:spTree'] as Record<string, unknown> | undefined;
    const shapes: DonorShape[] = [];
    if (spTree) {
      collectShapes(spTree, shapes, scheme);
    }

    // Keep the visually heaviest shapes (largest by area) first.
    shapes.sort((a, b) => b.w * b.h - a.w * a.h);
    const truncated = shapes.slice(0, maxShapesPerSlide);

    donors.push({
      index: slideIndex,
      name: slideName,
      ...(layoutName ? { layoutName } : {}),
      summary: '',
      shapes: truncated,
    });
  }

  return donors;
}

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

async function resolveLayoutName(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const dir = dirname(slidePath);
  const relsFile = `${dir}/_rels/${basename(slidePath)}.rels`;
  const relsXml = await zip.file(relsFile)?.async('string');
  if (!relsXml) return undefined;
  const parsed = xmlParser.parse(relsXml) as Record<string, unknown>;
  const root = parsed.Relationships as Record<string, unknown> | undefined;
  if (!root) return undefined;
  const list = root.Relationship;
  const entries: Record<string, string>[] = Array.isArray(list)
    ? (list as Record<string, string>[])
    : list
      ? [list as Record<string, string>]
      : [];
  const layoutEntry = entries.find((r) =>
    (r['@_Type'] ?? '').endsWith('/slideLayout'),
  );
  if (!layoutEntry) return undefined;
  const target = layoutEntry['@_Target'];
  if (!target) return undefined;
  const layoutPath = posix.normalize(`${dir}/${target}`);
  const layoutXml = await zip.file(layoutPath)?.async('string');
  if (!layoutXml) return undefined;
  const layoutParsed = xmlParser.parse(layoutXml) as Record<string, unknown>;
  const layoutRoot = layoutParsed['p:sldLayout'] as Record<string, unknown> | undefined;
  const layoutCSld = layoutRoot?.['p:cSld'] as Record<string, unknown> | undefined;
  const name = layoutCSld?.['@_name'] as string | undefined;
  return name?.trim() || undefined;
}

function collectShapes(
  spTree: Record<string, unknown>,
  out: DonorShape[],
  scheme: ThemeSchemeMap,
): void {
  // <p:sp> — text/rect/etc.
  for (const sp of arrayOf<Record<string, unknown>>(spTree['p:sp'])) {
    const shape = readSpShape(sp, scheme);
    if (shape) out.push(shape);
  }
  // <p:pic> — image shapes.
  for (const pic of arrayOf<Record<string, unknown>>(spTree['p:pic'])) {
    const shape = readPicShape(pic);
    if (shape) out.push(shape);
  }
  // <p:graphicFrame> — tables and charts.
  for (const gf of arrayOf<Record<string, unknown>>(spTree['p:graphicFrame'])) {
    const shape = readGraphicFrameShape(gf);
    if (shape) out.push(shape);
  }
  // <p:grpSp> — groups; recurse but DO NOT emit the group itself as a shape.
  for (const grp of arrayOf<Record<string, unknown>>(spTree['p:grpSp'])) {
    collectShapes(grp, out, scheme);
  }
}

function readSpShape(
  sp: Record<string, unknown>,
  scheme: ThemeSchemeMap,
): DonorShape | undefined {
  const geom = readGeometry(sp);
  if (!geom) return undefined;
  const name = readCNvPrName(sp['p:nvSpPr']);
  const placeholder = readPlaceholderType(sp['p:nvSpPr']);
  const txBody = sp['p:txBody'] as Record<string, unknown> | undefined;
  const spPr = sp['p:spPr'] as Record<string, unknown> | undefined;

  const fillColor = spPr ? readFillHex(spPr['a:solidFill'], scheme) : undefined;
  const flatText = txBody ? readFlatText(txBody, scheme) : undefined;
  const kind: DonorShape['kind'] = txBody
    ? 'text'
    : fillColor
      ? 'rect'
      : 'other';

  return {
    name: name ?? `Shape ${Math.round(geom.x * 100)}${Math.round(geom.y * 100)}`,
    kind,
    x: geom.x,
    y: geom.y,
    w: geom.w,
    h: geom.h,
    ...(placeholder ? { placeholder } : {}),
    ...(flatText?.fontFace ? { fontFace: flatText.fontFace } : {}),
    ...(flatText?.fontSize ? { fontSize: flatText.fontSize } : {}),
    ...(flatText?.bold ? { bold: flatText.bold } : {}),
    ...(fillColor ? { fillColor } : {}),
    ...(flatText?.textColor ? { textColor: flatText.textColor } : {}),
    ...(flatText?.sampleText ? { sampleText: flatText.sampleText } : {}),
  };
}

function readPicShape(pic: Record<string, unknown>): DonorShape | undefined {
  const geom = readGeometry(pic);
  if (!geom) return undefined;
  const name = readCNvPrName(pic['p:nvPicPr']);
  return {
    name: name ?? `Image @ ${Math.round(geom.x * 100)}${Math.round(geom.y * 100)}`,
    kind: 'image',
    x: geom.x,
    y: geom.y,
    w: geom.w,
    h: geom.h,
  };
}

function readGraphicFrameShape(gf: Record<string, unknown>): DonorShape | undefined {
  // graphicFrame uses <p:xfrm> rather than <p:spPr><a:xfrm>.
  const xfrm = gf['p:xfrm'] as Record<string, unknown> | undefined;
  const off = xfrm?.['a:off'] as Record<string, string> | undefined;
  const ext = xfrm?.['a:ext'] as Record<string, string> | undefined;
  if (!off || !ext) return undefined;
  const x = emuToInch(off['@_x']);
  const y = emuToInch(off['@_y']);
  const w = emuToInch(ext['@_cx']);
  const h = emuToInch(ext['@_cy']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;

  const name = readCNvPrName(gf['p:nvGraphicFramePr']);
  // Distinguish chart vs table by the graphicData URI if present.
  const graphic = gf['a:graphic'] as Record<string, unknown> | undefined;
  const graphicData = graphic?.['a:graphicData'] as Record<string, string> | undefined;
  const uri = graphicData?.['@_uri'] ?? '';
  let kind: DonorShape['kind'] = 'other';
  if (uri.includes('chart')) kind = 'chart';
  else if (uri.includes('table')) kind = 'table';

  return {
    name: name ?? `${kind} @ ${Math.round(x * 100)}${Math.round(y * 100)}`,
    kind,
    x,
    y,
    w,
    h,
  };
}

function readGeometry(sp: Record<string, unknown>): { x: number; y: number; w: number; h: number } | undefined {
  const spPr = sp['p:spPr'] as Record<string, unknown> | undefined;
  const xfrm = spPr?.['a:xfrm'] as Record<string, unknown> | undefined;
  const off = xfrm?.['a:off'] as Record<string, string> | undefined;
  const ext = xfrm?.['a:ext'] as Record<string, string> | undefined;
  if (!off || !ext) return undefined;
  const x = emuToInch(off['@_x']);
  const y = emuToInch(off['@_y']);
  const w = emuToInch(ext['@_cx']);
  const h = emuToInch(ext['@_cy']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

function readCNvPrName(nvNode: unknown): string | undefined {
  if (!nvNode || typeof nvNode !== 'object') return undefined;
  const n = nvNode as Record<string, unknown>;
  const cNvPr = n['p:cNvPr'] as Record<string, string> | undefined;
  return cNvPr?.['@_name'];
}

function readPlaceholderType(nvNode: unknown): string | undefined {
  if (!nvNode || typeof nvNode !== 'object') return undefined;
  const n = nvNode as Record<string, unknown>;
  const nvPr = n['p:nvPr'] as Record<string, unknown> | undefined;
  const ph = nvPr?.['p:ph'] as Record<string, string> | undefined;
  return ph?.['@_type'];
}

function emuToInch(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.round((n / EMU_PER_INCH) * 1000) / 1000;
}

function readFillHex(node: unknown, scheme: ThemeSchemeMap): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  const srgb = n['a:srgbClr'] as Record<string, string> | undefined;
  if (srgb?.['@_val'] && /^[0-9a-fA-F]{6}$/.test(srgb['@_val'])) {
    return srgb['@_val'].toUpperCase();
  }
  const schemeClr = n['a:schemeClr'] as Record<string, string> | undefined;
  const refVal = schemeClr?.['@_val'];
  if (refVal && refVal in scheme) {
    const hex = scheme[refVal as keyof ThemeSchemeMap];
    if (hex) return hex;
  }
  const sys = n['a:sysClr'] as Record<string, string> | undefined;
  if (sys?.['@_lastClr']) return sys['@_lastClr'].toUpperCase();
  return undefined;
}

type FlatTextInfo = {
  fontFace?: string;
  fontSize?: number;
  bold?: boolean;
  textColor?: string;
  sampleText?: string;
};

function readFlatText(
  txBody: Record<string, unknown>,
  scheme: ThemeSchemeMap,
): FlatTextInfo {
  const info: FlatTextInfo = {};
  const texts: string[] = [];
  const paragraphs = arrayOf<Record<string, unknown>>(txBody['a:p']);
  for (const p of paragraphs) {
    for (const r of arrayOf<Record<string, unknown>>(p['a:r'])) {
      const rPr = r['a:rPr'] as Record<string, unknown> | undefined;
      if (rPr) {
        const sz = (rPr['@_sz'] as string | undefined) ?? '';
        if (sz) {
          const n = Number(sz);
          if (Number.isFinite(n) && n > 0 && !info.fontSize) info.fontSize = Math.round(n / 100);
        }
        const bold = rPr['@_b'] as string | undefined;
        if ((bold === '1' || bold === 'true') && info.bold === undefined) info.bold = true;
        const latin = rPr['a:latin'] as Record<string, string> | undefined;
        if (latin?.['@_typeface'] && !info.fontFace) info.fontFace = latin['@_typeface'];
        const color = readFillHex(rPr['a:solidFill'], scheme);
        if (color && !info.textColor) info.textColor = color;
      }
      const t = (r['a:t'] as string | undefined) ?? '';
      if (t) texts.push(t);
    }
  }
  const joined = texts.join(' ').trim();
  if (joined) {
    // Keep at most ~3 words so the sample stays tight and tokens stay bounded.
    const words = joined.split(/\s+/).slice(0, 4);
    info.sampleText = words.join(' ').slice(0, 60);
  }
  return info;
}

function arrayOf<T = unknown>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}
