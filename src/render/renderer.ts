import { resolve } from 'node:path';
// pptxgenjs ships an awkward type shape (`export as namespace` + `export default`)
// that confuses tsc's constructable inference; the runtime export is a class.
// biome-ignore lint/suspicious/noExplicitAny: pptxgenjs constructor typing workaround
import pptxgenjsImport from 'pptxgenjs';
// biome-ignore lint/suspicious/noExplicitAny: see above
const PptxGenJS = pptxgenjsImport as unknown as new () => any;

/**
 * M1 placeholder renderer. Writes a fixed 3-slide deck:
 *   1. Title slide
 *   2. Bullet-list content slide
 *   3. Closing / thank-you slide
 *
 * M2 will replace this with a generic SlidePlan → pptxgenjs renderer; for now
 * this exists so the `/render` slash command can prove the toolchain works end-to-end.
 */
export async function renderSampleDeck(outPath: string): Promise<string> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'DeckPilot M1 Sample';

  const ACCENT = '0F62FE';
  const INK = '1F2328';

  const title = pres.addSlide();
  title.background = { color: 'FFFFFF' };
  title.addText('DeckPilot', {
    x: 0.5,
    y: 1.6,
    w: '90%',
    h: 1.2,
    fontFace: 'Inter',
    fontSize: 60,
    bold: true,
    color: ACCENT,
  });
  title.addText('Conversational PowerPoint via GitHub Copilot', {
    x: 0.5,
    y: 2.9,
    w: '90%',
    h: 0.8,
    fontFace: 'Inter',
    fontSize: 22,
    color: INK,
  });
  title.addText('M1 sample · /render', {
    x: 0.5,
    y: 5.8,
    w: '90%',
    h: 0.4,
    fontFace: 'Inter',
    fontSize: 14,
    color: '6E7781',
  });
  title.addNotes(
    'M1 milestone proof: this deck was emitted by pptxgenjs after a /render slash command in the chat loop.',
  );

  const body = pres.addSlide();
  body.addText('What this proves', {
    x: 0.5,
    y: 0.4,
    w: '90%',
    h: 0.8,
    fontFace: 'Inter',
    fontSize: 32,
    bold: true,
    color: ACCENT,
  });
  body.addText(
    [
      { text: 'oclif + Ink chat loop wired to the GitHub Copilot SDK', options: { bullet: true } },
      {
        text: 'Streaming assistant deltas + Ctrl+C cancellation',
        options: { bullet: true },
      },
      {
        text: 'pptxgenjs renderer reachable from the conversation',
        options: { bullet: true },
      },
      {
        text: 'install.sh puts deckpilot on $PATH from anywhere',
        options: { bullet: true },
      },
      {
        text: 'Outline-first generation, templates, charts → M2/M3/M4',
        options: { bullet: true, color: '6E7781' },
      },
    ],
    {
      x: 0.5,
      y: 1.4,
      w: '90%',
      h: 4.5,
      fontFace: 'Inter',
      fontSize: 22,
      color: INK,
      paraSpaceAfter: 6,
    },
  );
  body.addNotes('Each bullet maps to an M1 deliverable in the build plan.');

  const closing = pres.addSlide();
  closing.background = { color: ACCENT };
  closing.addText('Thanks.', {
    x: 0.5,
    y: 2.6,
    w: '90%',
    h: 1.2,
    fontFace: 'Inter',
    fontSize: 72,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
  });
  closing.addText('deckpilot · v0.1.0', {
    x: 0.5,
    y: 4.2,
    w: '90%',
    h: 0.6,
    fontFace: 'Inter',
    fontSize: 18,
    color: 'FFFFFF',
    align: 'center',
  });
  closing.addNotes('Closing slide. Replace with a generated outline once M2 lands.');

  const abs = resolve(process.cwd(), outPath);
  await pres.writeFile({ fileName: abs });
  return abs;
}
