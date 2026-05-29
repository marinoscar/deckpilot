/**
 * Build test/fixtures/sample-branded.pptx — a small but realistic .pptx the
 * extraction tests rely on. Re-run with `npm run fixtures` whenever you need
 * to regenerate it (and commit the result).
 *
 * Shape contract the fixture is designed to honour (the tests assert these):
 *   - 1 slide master with a navy background, a tiny logo (top-left p:pic),
 *     a black right rail rect, and a footer text.
 *   - 3 slides, each named, each using a distinct named-shape set:
 *       slide 1 — "Cover": Title + Subtitle
 *       slide 2 — "Body":  Title + BodyLeft + BodyRight
 *       slide 3 — "Cards": six Card<N> rects of distinct colours
 *   - Per-slide colour usage spans enough hues that palette-aggregate can
 *     find more than the theme alone exposes.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pptxgenjsImport from 'pptxgenjs';

// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs has no exported constructor type
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

// 1×1 navy PNG, base64. Tiny, deterministic, no external file deps.
const LOGO_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

const NAVY = '1A2B5E';
const BLACK = '000000';
const WHITE = 'FFFFFF';
const YELLOW = 'F1C21B';
const TEAL = '0AA1A1';
const RED = 'C8202E';
const MAGENTA = 'B8398A';
const GREEN = '2E8B47';
const ORANGE = 'E67E22';

const OUT = resolve(process.cwd(), 'test/fixtures/sample-branded.pptx');

async function main(): Promise<void> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'DeckPilot fixture';

  pres.defineSlideMaster({
    title: 'BrandMaster',
    background: { color: NAVY },
    objects: [
      // Logo top-left.
      { image: { x: 0.3, y: 0.3, w: 0.6, h: 0.6, data: LOGO_PNG } },
      // Black right rail.
      { rect: { x: 12.4, y: 0, w: 0.93, h: 7.5, fill: { color: BLACK } } },
      // Footer text.
      {
        text: {
          text: 'BRAND v0.16 fixture',
          options: {
            x: 0.4,
            y: 7.1,
            w: 8,
            h: 0.3,
            fontFace: 'Helvetica',
            fontSize: 9,
            color: WHITE,
            align: 'left',
          },
        },
      },
    ],
  });

  // -- Slide 1: Cover --------------------------------------------------
  const s1 = pres.addSlide({ masterName: 'BrandMaster' });
  s1.addText('Knowledge graphs', {
    x: 0.6,
    y: 2.5,
    w: 11,
    h: 1.6,
    fontFace: 'Inter Tight',
    fontSize: 60,
    bold: true,
    color: WHITE,
    objectName: 'Title',
  });
  s1.addText('A pragmatic guide', {
    x: 0.6,
    y: 4.3,
    w: 11,
    h: 0.8,
    fontFace: 'Inter',
    fontSize: 28,
    color: YELLOW,
    objectName: 'Subtitle',
  });

  // -- Slide 2: Body two-column ----------------------------------------
  const s2 = pres.addSlide({ masterName: 'BrandMaster' });
  s2.addText('Two views, one story', {
    x: 0.6,
    y: 0.6,
    w: 11,
    h: 1,
    fontFace: 'Inter Tight',
    fontSize: 36,
    bold: true,
    color: WHITE,
    objectName: 'Title',
  });
  s2.addText(
    'Left column body text covers the contextual frame; this side argues for the simpler model.',
    {
      x: 0.6,
      y: 2,
      w: 5.6,
      h: 4,
      fontFace: 'Inter',
      fontSize: 18,
      color: WHITE,
      objectName: 'BodyLeft',
    },
  );
  s2.addText(
    'Right column body text covers the counter-argument; complexity has its place when the data demands it.',
    {
      x: 6.4,
      y: 2,
      w: 5.6,
      h: 4,
      fontFace: 'Inter',
      fontSize: 18,
      color: WHITE,
      objectName: 'BodyRight',
    },
  );

  // -- Slide 3: Six category cards -------------------------------------
  const s3 = pres.addSlide({ masterName: 'BrandMaster' });
  s3.addText('Every output stream is in scope', {
    x: 0.6,
    y: 0.4,
    w: 11,
    h: 0.9,
    fontFace: 'Inter Tight',
    fontSize: 30,
    bold: true,
    color: WHITE,
    objectName: 'Title',
  });
  const cardColors = [
    { c: YELLOW, label: 'Code' },
    { c: TEAL, label: 'Dashboards' },
    { c: RED, label: 'Reports' },
    { c: MAGENTA, label: 'Presentations' },
    { c: GREEN, label: 'Analyses' },
    { c: ORANGE, label: 'Project artifacts' },
  ];
  const startX = 0.6;
  const startY = 1.6;
  const cardW = 3.7;
  const cardH = 2.4;
  const gapX = 0.2;
  const gapY = 0.2;
  cardColors.forEach((card, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    s3.addShape('rect', {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: card.c },
      line: { color: card.c, width: 0 },
      objectName: `CardBg${i + 1}`,
    });
    s3.addText(card.label, {
      x: x + 0.25,
      y: y + 0.25,
      w: cardW - 0.5,
      h: 0.5,
      fontFace: 'Inter Tight',
      fontSize: 18,
      bold: true,
      color: WHITE,
      objectName: `CardTitle${i + 1}`,
    });
  });

  mkdirSync(dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });
  console.log(`Wrote fixture: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
