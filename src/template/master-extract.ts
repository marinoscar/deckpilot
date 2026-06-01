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
import type { Master, MasterBackground, MasterObject } from './spec.js';

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
  /**
   * Zip source path of the master's all-slides background image, when it has
   * one (e.g. `ppt/media/image2.png`). The cover-background extractor uses this
   * to avoid re-emitting the same image as a distinct cover.
   */
  backgroundMedia?: string;
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
    const { background, mediaPath: backgroundMedia } = await extractBackground(
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
      await extractShapesInto(objects, spTree, candidate, zip, templateRootDir, copiedAssets);
    }

    // Skip empty candidates — they don't contribute brand chrome.
    if (!background && objects.length === 0) continue;

    const master: Master = {};
    if (background) master.background = background;
    if (objects.length > 0) master.objects = objects;

    // Re-validate via the schema's refinement (background OR objects required).
    return { master, copiedAssets, backgroundMedia };
  }

  return { master: undefined, copiedAssets };
}

export type CoverBackgroundResult = {
  /** Relative `assets/…` path of the copied cover background, or undefined. */
  src?: string;
  /** Asset paths written into `<templateRootDir>/assets/` (forward slashes). */
  copiedAssets: string[];
  /**
   * Zip media path of the emitted cover image (set only when `src` is set), so
   * the content-background extractor can avoid reusing the cover as content.
   */
  mediaPath?: string;
};

/**
 * Extract the *cover* background image — the full-bleed hero a branded deck
 * puts behind its title slide (and section dividers). This is distinct from
 * the all-slides master background (`extractMasterFromPptx`): the cover image
 * is meant for covers/dividers only, so it lands in `assets.background` and the
 * code-gen LLM paints it where appropriate (rather than the renderer painting
 * it on every slide via the slide master).
 *
 * Resolution order, first image wins:
 *   1. `ppt/slides/slide1.xml`'s own `<p:bg>` blip fill.
 *   2. The layout `slide1.xml` references → that layout's `<p:bg>` blip.
 *   3. The first `title` / `sectionHeader` layout carrying a `<p:bg>` blip.
 *
 * Returns undefined when no image background is found, or when the resolved
 * media equals `excludeMedia` (the all-slides master background already copied
 * as `assets/master-background.*`) — that's not a distinct cover.
 *
 * When `templateRootDir` is undefined there's nowhere to write the bytes, so
 * the function returns undefined (consistent with the master extractor).
 */
export async function extractCoverBackground(
  zip: JSZip,
  templateRootDir: string | undefined,
  excludeMedia?: string,
): Promise<CoverBackgroundResult> {
  const copiedAssets: string[] = [];
  if (!templateRootDir) return { copiedAssets };

  const mediaPath = await findCoverBackgroundMedia(zip);
  if (!mediaPath) return { copiedAssets };
  // Dedup against the all-slides master background — same file isn't a cover.
  if (excludeMedia && mediaPath === excludeMedia) return { copiedAssets };

  const ext = mediaPath.split('.').pop() ?? 'png';
  const out = `assets/cover-background.${ext}`;
  await copyMedia(zip, mediaPath, join(templateRootDir, ...out.split('/')));
  copiedAssets.push(out);
  return { src: out, copiedAssets, mediaPath };
}

export type ContentBackgroundResult = {
  /** The content / all-slides background: a copied image or a solid colour. */
  background: MasterBackground;
  /** Asset paths written into `<templateRootDir>/assets/` (forward slashes). */
  copiedAssets: string[];
  /** Zip media path when the content background resolved to an image. */
  mediaPath?: string;
};

export type ContentBackgroundOpts = {
  /** Media paths NOT to treat as content (e.g. the cover image). */
  excludeMedia?: Iterable<string>;
  /** Already-copied media → relative asset path, reused instead of re-copying. */
  knownMedia?: Map<string, string>;
};

/**
 * Extract the *content* background — the background ordinary body slides
 * inherit, distinct from the cover hero. Resolves a representative content
 * slide's effective background (slide → its layout → the slide master), in
 * order of preference:
 *
 *   1. An image background → copied to `assets/content-background.*` (or the
 *      existing `assets/master-background.*` when it's the same media), unless
 *      it's the excluded cover image.
 *   2. A solid-fill background → `{ type: 'solid', color }`.
 *   3. Fallback: a solid fill of the deck's paper colour.
 *
 * Always returns a background so content slides get a deliberate canvas.
 */
export async function extractContentBackground(
  zip: JSZip,
  templateRootDir: string | undefined,
  paperHex: string,
  opts: ContentBackgroundOpts = {},
): Promise<ContentBackgroundResult> {
  const copiedAssets: string[] = [];
  const exclude = new Set(opts.excludeMedia ?? []);
  const known = opts.knownMedia ?? new Map<string, string>();

  const slidePath = await firstContentSlide(zip);

  // 1. Image background (slide → layout → master), unless it's the cover image.
  const imageMedia = slidePath ? await effectiveBgImageMedia(zip, slidePath) : undefined;
  if (imageMedia && !exclude.has(imageMedia)) {
    const reused = known.get(imageMedia);
    if (reused) {
      return { background: { type: 'image', src: reused }, copiedAssets, mediaPath: imageMedia };
    }
    if (templateRootDir) {
      const ext = imageMedia.split('.').pop() ?? 'png';
      const out = `assets/content-background.${ext}`;
      await copyMedia(zip, imageMedia, join(templateRootDir, ...out.split('/')));
      copiedAssets.push(out);
      return { background: { type: 'image', src: out }, copiedAssets, mediaPath: imageMedia };
    }
  }

  // 2. Solid-fill background (slide → layout → master).
  const solid = slidePath ? await effectiveBgSolid(zip, slidePath) : undefined;
  if (solid) return { background: { type: 'solid', color: solid }, copiedAssets };

  // 3. Fallback: the deck's paper colour.
  return { background: { type: 'solid', color: paperHex.toUpperCase() }, copiedAssets };
}

/**
 * The first slide we treat as "content": skips slide1 (the cover) and any slide
 * whose layout is a `title`/`sectionHeader`. Falls back to slide2, then slide1,
 * when the deck has no clearly-typed content slide.
 */
async function firstContentSlide(zip: JSZip): Promise<string | undefined> {
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNum(a) - slideNum(b));
  for (const path of slidePaths) {
    if (path === 'ppt/slides/slide1.xml') continue;
    const type = await resolveLayoutType(zip, path);
    if (type === 'title' || type === 'sectionHeader') continue;
    return path;
  }
  return slidePaths.find((p) => p !== 'ppt/slides/slide1.xml') ?? slidePaths[0];
}

function slideNum(p: string): number {
  return Number(p.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

/** Resolve a slide's layout `@_type` (`title` / `sectionHeader` / …) via its rels. */
async function resolveLayoutType(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const rels = await readRels(zip, slidePath);
  const layoutTarget = [...rels.values()].find((t) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(t),
  );
  if (!layoutTarget) return undefined;
  const xml = await zip.file(layoutTarget)?.async('string');
  if (!xml) return undefined;
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const layout = parsed['p:sldLayout'] as Record<string, string> | undefined;
  return layout?.['@_type'];
}

/** Effective image background of a slide: slide → its layout → slideMaster1. */
async function effectiveBgImageMedia(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const rels = await readRels(zip, slidePath);
  const fromSlide = await bgBlipMedia(zip, slidePath, 'p:sld', rels);
  if (fromSlide) return fromSlide;

  const layoutTarget = [...rels.values()].find((t) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(t),
  );
  if (layoutTarget) {
    const layoutRels = await readRels(zip, layoutTarget);
    const fromLayout = await bgBlipMedia(zip, layoutTarget, 'p:sldLayout', layoutRels);
    if (fromLayout) return fromLayout;
  }

  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  if (zip.file(masterPath)) {
    const masterRels = await readRels(zip, masterPath);
    const fromMaster = await bgBlipMedia(zip, masterPath, 'p:sldMaster', masterRels);
    if (fromMaster) return fromMaster;
  }
  return undefined;
}

/** Effective solid-fill background hex of a slide: slide → its layout → slideMaster1. */
async function effectiveBgSolid(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const fromSlide = await bgSolidHex(zip, slidePath, 'p:sld');
  if (fromSlide) return fromSlide;

  const rels = await readRels(zip, slidePath);
  const layoutTarget = [...rels.values()].find((t) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(t),
  );
  if (layoutTarget) {
    const fromLayout = await bgSolidHex(zip, layoutTarget, 'p:sldLayout');
    if (fromLayout) return fromLayout;
  }

  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  if (zip.file(masterPath)) {
    const fromMaster = await bgSolidHex(zip, masterPath, 'p:sldMaster');
    if (fromMaster) return fromMaster;
  }
  return undefined;
}

/** Read `<p:bg><p:bgPr><a:solidFill>` from a part as a 6-hex string. */
async function bgSolidHex(
  zip: JSZip,
  xmlPath: string,
  rootTag: string,
): Promise<string | undefined> {
  const xml = await zip.file(xmlPath)?.async('string');
  if (!xml) return undefined;
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const root = parsed[rootTag] as Record<string, unknown> | undefined;
  const cSld = root?.['p:cSld'] as Record<string, unknown> | undefined;
  const bg = cSld?.['p:bg'] as Record<string, unknown> | undefined;
  const bgPr = bg?.['p:bgPr'] as Record<string, unknown> | undefined;
  const solid = bgPr?.['a:solidFill'];
  return solid ? readSolidFillHex(solid) : undefined;
}

/**
 * Resolve the title slide's effective image background to a zip media path,
 * walking slide → its layout → the title/sectionHeader layouts. Returns the
 * `ppt/media/*` path, or undefined when no blip-fill background exists.
 */
async function findCoverBackgroundMedia(zip: JSZip): Promise<string | undefined> {
  // 1. slide1.xml's own background.
  const slidePath = 'ppt/slides/slide1.xml';
  if (zip.file(slidePath)) {
    const rels = await readRels(zip, slidePath);
    const fromSlide = await bgBlipMedia(zip, slidePath, 'p:sld', rels);
    if (fromSlide) return fromSlide;

    // 2. The layout slide1 references.
    const layoutTarget = [...rels.values()].find((t) =>
      /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(t),
    );
    if (layoutTarget) {
      const layoutRels = await readRels(zip, layoutTarget);
      const fromLayout = await bgBlipMedia(zip, layoutTarget, 'p:sldLayout', layoutRels);
      if (fromLayout) return fromLayout;
    }
  }

  // 3. First title / sectionHeader layout with a blip background.
  const layoutPaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
    .sort();
  for (const path of layoutPaths) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const layout = parsed['p:sldLayout'] as Record<string, string> | undefined;
    const type = layout?.['@_type'];
    if (type !== 'title' && type !== 'sectionHeader') continue;
    const rels = await readRels(zip, path);
    const media = await bgBlipMedia(zip, path, 'p:sldLayout', rels);
    if (media) return media;
  }

  return undefined;
}

/**
 * Read `<p:bg><p:bgPr><a:blipFill><a:blip r:embed>` from an already-located
 * part and resolve the embed to a zip media path. `rootTag` is the document
 * root element (`p:sld` / `p:sldLayout` / `p:sldMaster`).
 */
async function bgBlipMedia(
  zip: JSZip,
  xmlPath: string,
  rootTag: string,
  rels: Map<string, string>,
): Promise<string | undefined> {
  const xml = await zip.file(xmlPath)?.async('string');
  if (!xml) return undefined;
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const root = parsed[rootTag] as Record<string, unknown> | undefined;
  const cSld = root?.['p:cSld'] as Record<string, unknown> | undefined;
  const bg = cSld?.['p:bg'] as Record<string, unknown> | undefined;
  const bgPr = bg?.['p:bgPr'] as Record<string, unknown> | undefined;
  const blip = bgPr?.['a:blipFill'] as Record<string, unknown> | undefined;
  const rId = blip && getRId(blip['a:blip']);
  if (!rId) return undefined;
  return rels.get(rId);
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
): Promise<{ background?: Master['background']; mediaPath?: string }> {
  const bg = cSld['p:bg'] as Record<string, unknown> | undefined;
  if (!bg) return {};
  const bgPr = bg['p:bgPr'] as Record<string, unknown> | undefined;
  if (!bgPr) return {};

  // Solid fill.
  const solid = bgPr['a:solidFill'] as Record<string, unknown> | undefined;
  const solidHex = solid ? readSolidFillHex(solid) : undefined;
  if (solidHex) return { background: { type: 'solid', color: solidHex } };

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
        return { background: { type: 'image', src: out }, mediaPath };
      }
    }
  }

  return {};
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

function readGeometry(
  sp: Record<string, unknown>,
): { x: number; y: number; w: number; h: number } | undefined {
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
