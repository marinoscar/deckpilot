import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { extractDonorGeometry } from './donor-geometry.js';
import { extractCoverBackground, extractMasterFromPptx } from './master-extract.js';
import { type ThemeSchemeMap, aggregatePalette, readThemeSchemeMap } from './palette-aggregate.js';
import type { TemplateProfile } from './profile.js';
import type { ThemePalette } from './spec.js';

/**
 * Fallback colours/fonts when a template has no explicit theme part. Kept
 * conservative so the inherited "design system" reads as a generic editorial
 * baseline rather than something that screams "we couldn't find your brand".
 */
const FALLBACK = {
  accent: '0F62FE',
  accentDark: '002D9C',
  fontHeading: 'Inter Tight',
  fontBody: 'Inter',
} as const;

const EMU_PER_INCH = 914400;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false, // keep `a:` / `p:` prefixes so we can navigate semantically
});

/**
 * Options for inspectTemplate.
 *
 * - `templateRootDir`: when provided, master extraction copies media (logo,
 *   background image) into `<templateRootDir>/assets/`. Without it, media
 *   refs are skipped (the master shape still captures solid backgrounds and
 *   rect/text objects).
 * - `extractMaster` / `extractPalette` / `extractDonorGeometry`: per-feature
 *   opt-outs for the CLI flags `--no-master`, `--no-palette-samples`,
 *   `--no-donor-geometry`. All default true.
 * - `maxDonorSlides` / `maxShapesPerDonor`: bound the donor catalog size.
 */
export type InspectOpts = {
  templateRootDir?: string;
  extractMaster?: boolean;
  extractCoverBackground?: boolean;
  extractPalette?: boolean;
  extractDonorGeometry?: boolean;
  maxDonorSlides?: number;
  maxShapesPerDonor?: number;
};

/**
 * Parse a user-supplied `.pptx` into a TemplateProfile. Reads OOXML parts:
 * theme/theme1.xml (colours + fonts), presentation.xml (slide size),
 * slideMasters + slideLayouts (layout names + brand chrome), every
 * slide<N>.xml (palette samples + donor geometry).
 *
 * Failure modes are non-fatal where possible: a missing field falls back to
 * FALLBACK or a reasonable inference. A genuinely unparseable file
 * (not a zip, not a pptx, corrupt XML) throws with a clear message.
 */
export async function inspectTemplate(
  path: string,
  opts: InspectOpts = {},
): Promise<TemplateProfile> {
  const abs = resolve(process.cwd(), path);
  const buf = await readFile(abs);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new Error(`${path} is not a valid .pptx (not a zip archive): ${(e as Error).message}`);
  }
  if (!zip.file('ppt/presentation.xml')) {
    throw new Error(`${path} doesn't look like a .pptx — no ppt/presentation.xml inside.`);
  }

  const aspect = await readSlideSize(zip);
  const { colors, fonts } = await readThemeAndFonts(zip);
  const layoutNames = await readLayoutNames(zip);

  const profile: TemplateProfile = {
    sourcePath: abs,
    aspect: aspect.aspect,
    slideSize: aspect.size,
    colors,
    fonts,
    layoutNames,
  };

  // v0.16 enrichments — each is independently opt-out via opts.
  let masterBackgroundMedia: string | undefined;
  if (opts.extractMaster !== false) {
    const { master, copiedAssets, backgroundMedia } = await extractMasterFromPptx(
      zip,
      opts.templateRootDir,
    );
    if (master) profile.master = master;
    if (copiedAssets.length > 0) profile.copiedAssets = copiedAssets;
    masterBackgroundMedia = backgroundMedia;
  }

  // Cover/title background — a full-bleed hero for covers/dividers, distinct
  // from the all-slides master background. Lands in assets.background; the
  // code-gen LLM paints it where appropriate.
  if (opts.extractCoverBackground !== false) {
    const cover = await extractCoverBackground(zip, opts.templateRootDir, masterBackgroundMedia);
    if (cover.src) profile.assets = { ...profile.assets, background: cover.src };
    if (cover.copiedAssets.length > 0) {
      profile.copiedAssets = [...(profile.copiedAssets ?? []), ...cover.copiedAssets];
    }
  }

  // Palette + donor geometry both need the theme scheme map. Build it once.
  const needScheme = opts.extractPalette !== false || opts.extractDonorGeometry !== false;
  const scheme = needScheme ? await readThemeSchemeMap(zip) : {};

  if (opts.extractPalette !== false) {
    const samples = await aggregatePalette(zip, scheme);
    if (samples.length > 0) profile.paletteSamples = samples;
    const palette = themePaletteFromScheme(scheme);
    if (palette) profile.themePalette = palette;
  }

  if (opts.extractDonorGeometry !== false) {
    const donors = await extractDonorGeometry(zip, scheme, {
      maxSlides: opts.maxDonorSlides,
      maxShapesPerSlide: opts.maxShapesPerDonor,
    });
    if (donors.length > 0) profile.donorGeometry = donors;
  }

  return profile;
}

/**
 * Map the OOXML scheme map onto the spec's named ThemePalette. Renames the
 * hyperlink tokens (`hlink`/`folHlink` → `hyperlink`/`followedHyperlink`);
 * everything else carries its OOXML name. Returns undefined when the scheme
 * yielded no colours.
 */
function themePaletteFromScheme(scheme: ThemeSchemeMap): ThemePalette | undefined {
  const palette: ThemePalette = {};
  const direct = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
  ] as const;
  for (const k of direct) {
    if (scheme[k]) palette[k] = scheme[k];
  }
  if (scheme.hlink) palette.hyperlink = scheme.hlink;
  if (scheme.folHlink) palette.followedHyperlink = scheme.folHlink;
  return Object.keys(palette).length > 0 ? palette : undefined;
}

async function readSlideSize(
  zip: JSZip,
): Promise<{ aspect: TemplateProfile['aspect']; size: { width: number; height: number } }> {
  const pres = await zip.file('ppt/presentation.xml')?.async('string');
  if (!pres) return { aspect: 'other', size: { width: 13.33, height: 7.5 } };
  const parsed = xmlParser.parse(pres) as Record<string, unknown>;
  const node = (parsed['p:presentation'] as Record<string, unknown> | undefined)?.['p:sldSz'] as
    | Record<string, string>
    | undefined;
  if (!node) return { aspect: 'other', size: { width: 13.33, height: 7.5 } };
  const cx = Number(node['@_cx'] ?? 0);
  const cy = Number(node['@_cy'] ?? 0);
  const w = Math.round((cx / EMU_PER_INCH) * 100) / 100;
  const h = Math.round((cy / EMU_PER_INCH) * 100) / 100;
  const ratio = cy ? cx / cy : 0;
  let aspect: TemplateProfile['aspect'] = 'other';
  if (Math.abs(ratio - 16 / 9) < 0.02) aspect = '16:9';
  else if (Math.abs(ratio - 4 / 3) < 0.02) aspect = '4:3';
  return { aspect, size: { width: w, height: h } };
}

async function readThemeAndFonts(
  zip: JSZip,
): Promise<{ colors: TemplateProfile['colors']; fonts: TemplateProfile['fonts'] }> {
  const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string');
  if (!themeXml) {
    return {
      colors: { accent: FALLBACK.accent, accentDark: FALLBACK.accentDark },
      fonts: { heading: FALLBACK.fontHeading, body: FALLBACK.fontBody },
    };
  }
  const parsed = xmlParser.parse(themeXml) as Record<string, unknown>;
  const elements = (parsed['a:theme'] as Record<string, unknown> | undefined)?.[
    'a:themeElements'
  ] as Record<string, unknown> | undefined;
  const clrScheme = elements?.['a:clrScheme'] as Record<string, unknown> | undefined;
  const fontScheme = elements?.['a:fontScheme'] as Record<string, unknown> | undefined;
  return {
    colors: extractColors(clrScheme),
    fonts: extractFonts(fontScheme),
  };
}

function extractColors(clr?: Record<string, unknown>): TemplateProfile['colors'] {
  if (!clr) return { accent: FALLBACK.accent };
  const accent = colorFromNode(clr['a:accent1']);
  return {
    accent: accent ?? FALLBACK.accent,
    accentDark: colorFromNode(clr['a:accent2']) ?? undefined,
    ink: colorFromNode(clr['a:dk1']) ?? colorFromNode(clr['a:dk2']),
    muted: colorFromNode(clr['a:accent3']),
    paper: colorFromNode(clr['a:lt1']) ?? colorFromNode(clr['a:lt2']) ?? 'FFFFFF',
  };
}

function colorFromNode(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  // Inline sRGB: <a:accent1><a:srgbClr val="0F62FE"/></a:accent1>
  const srgb = n['a:srgbClr'] as Record<string, string> | undefined;
  if (srgb && srgb['@_val']) return srgb['@_val'].toUpperCase();
  // System color hint: <a:sysClr val="windowText" lastClr="000000"/>
  const sys = n['a:sysClr'] as Record<string, string> | undefined;
  if (sys && sys['@_lastClr']) return sys['@_lastClr'].toUpperCase();
  return undefined;
}

function extractFonts(font?: Record<string, unknown>): TemplateProfile['fonts'] {
  const def = { heading: FALLBACK.fontHeading, body: FALLBACK.fontBody };
  if (!font) return def;
  const major = font['a:majorFont'] as Record<string, unknown> | undefined;
  const minor = font['a:minorFont'] as Record<string, unknown> | undefined;
  return {
    heading: latinFromFontNode(major) ?? def.heading,
    body: latinFromFontNode(minor) ?? def.body,
  };
}

function latinFromFontNode(node?: Record<string, unknown>): string | undefined {
  const latin = node?.['a:latin'] as Record<string, string> | undefined;
  return latin?.['@_typeface'] ?? undefined;
}

async function readLayoutNames(zip: JSZip): Promise<string[]> {
  const names: string[] = [];
  const layoutPaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p),
  );
  // Sort by numeric suffix so the order matches the PPT file's layout order.
  layoutPaths.sort((a, b) => {
    const na = Number(a.match(/slideLayout(\d+)\.xml$/)?.[1] ?? 0);
    const nb = Number(b.match(/slideLayout(\d+)\.xml$/)?.[1] ?? 0);
    return na - nb;
  });
  for (const p of layoutPaths) {
    const xml = await zip.file(p)?.async('string');
    if (!xml) continue;
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const layout = parsed['p:sldLayout'] as Record<string, unknown> | undefined;
    const csld = layout?.['p:cSld'] as Record<string, string> | undefined;
    const name = csld?.['@_name'];
    if (name) names.push(name);
  }
  return names;
}
