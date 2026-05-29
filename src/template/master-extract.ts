/**
 * Extract the source .pptx's brand "master" — the visuals that should appear
 * on every slide DeckPilot later generates from this template. Output goes
 * into TemplateSpec.master; the renderer translates it into a pptxgenjs
 * defineSlideMaster() call at render time.
 *
 * The extractor walks slideMaster1.xml AND the layouts it owns, returning
 * the first one carrying brand chrome (background or ≥1 emittable shape).
 * Real PowerPoint files typically keep the logo + footer in the master;
 * pptxgenjs-emitted files keep them in a layout. We handle both.
 *
 * Media files referenced by `<p:pic>` and `<p:blipFill>` are copied out of
 * `ppt/media/` into the template's `assets/` directory so the renderer can
 * point pptxgenjs at them by relative path.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type JSZip from 'jszip';
import type { Master, MasterObject } from './spec.js';

const EMU_PER_INCH = 914400;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

export type MasterExtractResult = {
  /** The master to write into TemplateSpec.master (or undefined if nothing extractable). */
  master?: Master;
  /** Asset paths written into `<templateRootDir>/assets/` (relative paths, forward slashes). */
  copiedAssets: string[];
};

/**
 * Walk slideMaster1.xml + every slideLayout it owns; return the first one
 * carrying brand chrome (a non-trivial background OR at least one extractable
 * shape) as a Master spec. Media referenced from the chosen XML is copied
 * into `<templateRootDir>/assets/`.
 *
 * When `templateRootDir` is undefined, image background and `<p:pic>` shapes
 * are skipped (we have no place to write the bytes); rect/text objects and
 * solid backgrounds are still returned.
 */
export async function extractMasterFromPptx(
  zip: JSZip,
  templateRootDir: string | undefined,
): Promise<MasterExtractResult> {
  const candidates = await listMasterCandidates(zip);
  const copiedAssets: string[] = [];

  for (const candidate of candidates) {
    const xml = await zip.file(candidate.path)?.async('string');
    if (!xml) continue;
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;

    const rootNode =
      (parsed['p:sldMaster'] as Record<string, unknown> | undefined) ??
      (parsed['p:sldLayout'] as Record<string, unknown> | undefined);
    if (!rootNode) continue;

    const cSld = rootNode['p:cSld'] as Record<string, unknown> | undefined;
    if (!cSld) continue;

    // 1. Background.
    const background = await extractBackground(
      cSld,
      candidate,
      zip,
      templateRootDir,
      copiedAssets,
    );

    // 2. Shapes inside spTree.
    const spTree = cSld['p:spTree'] as Record<string, unknown> | undefined;
    const objects: MasterObject[] = [];
    if (spTree) {
      await extractShapesInto(
        objects,
        spTree,
        candidate,
        zip,
        templateRootDir,
        copiedAssets,
      );
    }

    // Skip empty candidates — they don't contribute brand chrome.
    if (!background && objects.length === 0) continue;

    const master: Master = {};
    if (background) master.background = background;
    if (objects.length > 0) master.objects = objects;

    // Re-validate via the schema's refinement (background OR objects required).
    return { master, copiedAssets };
  }

  return { master: undefined, copiedAssets };
}

/**
 * Candidate XMLs to inspect, in priority order: slideMaster1.xml first, then
 * every layout it references via its `_rels` file. The first non-empty match
 * wins.
 */
type Candidate = {
  /** Zip path of the XML, e.g. `ppt/slideMasters/slideMaster1.xml`. */
  path: string;
  /** Directory inside the zip the XML lives in (for resolving rels). */
  basePath: string;
  /** Relationship Id → resolved zip path target. */
  rels: Map<string, string>;
};

async function listMasterCandidates(zip: JSZip): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  if (zip.file(masterPath)) {
    const rels = await readRels(zip, masterPath);
    candidates.push({ path: masterPath, basePath: 'ppt/slideMasters', rels });

    // Walk the layouts the master references in declaration order.
    for (const [, target] of [...rels.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(target)) {
        const layoutRels = await readRels(zip, target);
        candidates.push({ path: target, basePath: 'ppt/slideLayouts', rels: layoutRels });
      }
    }
  }

  // Fallback: walk every layout that wasn't already enumerated.
  const seen = new Set(candidates.map((c) => c.path));
  for (const path of Object.keys(zip.files)) {
    if (seen.has(path)) continue;
    if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path)) {
      const rels = await readRels(zip, path);
      candidates.push({ path, basePath: 'ppt/slideLayouts', rels });
    }
  }

  return candidates;
}

async function readRels(zip: JSZip, xmlPath: string): Promise<Map<string, string>> {
  const dir = dirname(xmlPath);
  const file = `${dir}/_rels/${basename(xmlPath)}.rels`;
  const rels = new Map<string, string>();
  const xml = await zip.file(file)?.async('string');
  if (!xml) return rels;
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const root = parsed.Relationships as Record<string, unknown> | undefined;
  if (!root) return rels;
  const list = root.Relationship;
  const entries: Record<string, string>[] = Array.isArray(list)
    ? (list as Record<string, string>[])
    : list
      ? [list as Record<string, string>]
      : [];
  for (const entry of entries) {
    const id = entry['@_Id'];
    const target = entry['@_Target'];
    if (!id || !target) continue;
    // Resolve relative-to-xml POSIX paths inside the zip.
    const resolved = resolveZipPath(dir, target);
    rels.set(id, resolved);
  }
  return rels;
}

/**
 * Resolve a relationship Target (e.g. `../media/image1.png`) against the
 * directory the XML lives in (`ppt/slideMasters`). Returns a POSIX-style zip
 * path (`ppt/media/image1.png`).
 */
function resolveZipPath(fromDir: string, target: string): string {
  // jszip uses forward-slash paths; posix.normalize gives us correct ../ handling.
  return posix.normalize(`${fromDir}/${target}`);
}

async function extractBackground(
  cSld: Record<string, unknown>,
  candidate: Candidate,
  zip: JSZip,
  templateRootDir: string | undefined,
  copiedAssets: string[],
): Promise<Master['background'] | undefined> {
  const bg = cSld['p:bg'] as Record<string, unknown> | undefined;
  if (!bg) return undefined;
  const bgPr = bg['p:bgPr'] as Record<string, unknown> | undefined;
  if (!bgPr) return undefined;

  // Solid fill.
  const solid = bgPr['a:solidFill'] as Record<string, unknown> | undefined;
  const solidHex = solid ? readSolidFillHex(solid) : undefined;
  if (solidHex) return { type: 'solid', color: solidHex };

  // Image (blip) fill.
  if (templateRootDir) {
    const blip = bgPr['a:blipFill'] as Record<string, unknown> | undefined;
    const rId = blip && getRId(blip['a:blip']);
    if (rId) {
      const mediaPath = candidate.rels.get(rId);
      if (mediaPath) {
        const ext = mediaPath.split('.').pop() ?? 'png';
        const out = `assets/master-background.${ext}`;
        await copyMedia(zip, mediaPath, join(templateRootDir, ...out.split('/')));
        if (!copiedAssets.includes(out)) copiedAssets.push(out);
        return { type: 'image', src: out };
      }
    }
  }

  return undefined;
}

async function extractShapesInto(
  out: MasterObject[],
  spTree: Record<string, unknown>,
  candidate: Candidate,
  zip: JSZip,
  templateRootDir: string | undefined,
  copiedAssets: string[],
): Promise<void> {
  // <p:pic> images.
  for (const pic of arrayOf<Record<string, unknown>>(spTree['p:pic'])) {
    if (!templateRootDir) continue;
    const geom = readGeometry(pic);
    if (!geom) continue;
    const blip = (pic['p:blipFill'] as Record<string, unknown> | undefined)?.['a:blip'];
    const rId = getRId(blip);
    const mediaPath = rId ? candidate.rels.get(rId) : undefined;
    if (!mediaPath) continue;
    const ext = mediaPath.split('.').pop() ?? 'png';
    const fileName = `assets/master-image-${out.length}.${ext}`;
    await copyMedia(zip, mediaPath, join(templateRootDir, ...fileName.split('/')));
    if (!copiedAssets.includes(fileName)) copiedAssets.push(fileName);
    out.push({ kind: 'image', src: fileName, ...geom });
  }

  // <p:sp> — rect (solid-fill) and text-bearing static shapes.
  for (const sp of arrayOf<Record<string, unknown>>(spTree['p:sp'])) {
    // Skip shapes carrying a placeholder ref — those are slot definitions, not chrome.
    if (isPlaceholder(sp)) continue;
    const geom = readGeometry(sp);
    if (!geom) continue;
    const spPr = sp['p:spPr'] as Record<string, unknown> | undefined;
    const prstGeom = spPr?.['a:prstGeom'] as Record<string, unknown> | undefined;
    const prst = (prstGeom?.['@_prst'] as string | undefined) ?? '';
    const solidFill = spPr ? readSolidFillHex(spPr['a:solidFill']) : undefined;
    const txBody = sp['p:txBody'] as Record<string, unknown> | undefined;

    // Text-bearing static shape.
    if (txBody) {
      const flat = readFlatText(txBody);
      if (flat.text) {
        out.push({
          kind: 'text',
          text: flat.text,
          ...geom,
          ...(flat.fontFace ? { fontFace: flat.fontFace } : {}),
          ...(flat.fontSize ? { fontSize: flat.fontSize } : {}),
          ...(flat.bold ? { bold: flat.bold } : {}),
          ...(flat.color ? { color: flat.color } : {}),
          ...(flat.align ? { align: flat.align } : {}),
        });
        continue;
      }
    }

    // Solid-fill rect.
    if (prst === 'rect' && solidFill) {
      out.push({ kind: 'rect', ...geom, fill: solidFill });
    }
  }
}

function arrayOf<T = unknown>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}

function isPlaceholder(sp: Record<string, unknown>): boolean {
  const nvSpPr = sp['p:nvSpPr'] as Record<string, unknown> | undefined;
  const nvPr = nvSpPr?.['p:nvPr'] as Record<string, unknown> | undefined;
  return Boolean(nvPr?.['p:ph']);
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

function emuToInch(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.round((n / EMU_PER_INCH) * 1000) / 1000;
}

function readSolidFillHex(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  const srgb = n['a:srgbClr'] as Record<string, string> | undefined;
  if (srgb?.['@_val'] && /^[0-9a-fA-F]{6}$/.test(srgb['@_val'])) {
    return srgb['@_val'].toUpperCase();
  }
  const sys = n['a:sysClr'] as Record<string, string> | undefined;
  if (sys?.['@_lastClr']) return sys['@_lastClr'].toUpperCase();
  return undefined;
}

function getRId(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, string>;
  return n['@_r:embed'] ?? n['@_r:link'];
}

type FlatText = {
  text: string;
  fontFace?: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

function readFlatText(txBody: Record<string, unknown>): FlatText {
  const out: FlatText = { text: '' };
  const paragraphs = arrayOf<Record<string, unknown>>(txBody['a:p']);
  const textParts: string[] = [];
  for (const p of paragraphs) {
    const pPr = p['a:pPr'] as Record<string, string> | undefined;
    const algn = pPr?.['@_algn'];
    if (algn === 'l') out.align = 'left';
    else if (algn === 'ctr') out.align = 'center';
    else if (algn === 'r') out.align = 'right';
    for (const r of arrayOf<Record<string, unknown>>(p['a:r'])) {
      const rPr = r['a:rPr'] as Record<string, unknown> | undefined;
      if (rPr) {
        const sz = (rPr['@_sz'] as string | undefined) ?? '';
        if (sz) {
          const n = Number(sz);
          // OOXML font size is in hundredths of a point (e.g. 4400 = 44pt).
          if (Number.isFinite(n) && n > 0) out.fontSize ??= Math.round(n / 100);
        }
        const bold = rPr['@_b'] as string | undefined;
        if (bold === '1' || bold === 'true') out.bold = true;
        const latin = rPr['a:latin'] as Record<string, string> | undefined;
        if (latin?.['@_typeface'] && !out.fontFace) out.fontFace = latin['@_typeface'];
        const colorHex = readSolidFillHex(rPr['a:solidFill']);
        if (colorHex && !out.color) out.color = colorHex;
      }
      const t = (r['a:t'] as string | undefined) ?? '';
      if (t) textParts.push(t);
    }
  }
  out.text = textParts.join(' ').trim();
  return out;
}

async function copyMedia(zip: JSZip, mediaPath: string, destAbs: string): Promise<void> {
  const bytes = await zip.file(mediaPath)?.async('nodebuffer');
  if (!bytes) return;
  await mkdir(dirname(destAbs), { recursive: true });
  await writeFile(destAbs, bytes);
}
