import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPreviewAvailable } from '../src/render/pptx-to-pngs.js';
import { buildStudyOriginalTool } from '../src/tools/extract.js';

const FIXTURE = join(__dirname, 'fixtures', 'sample-branded.pptx');

describe('buildStudyOriginalTool', () => {
  it('defines a study_original_slides tool with no parameters', () => {
    const tool = buildStudyOriginalTool(FIXTURE);
    expect(tool.name).toBe('study_original_slides');
    expect(typeof tool.handler).toBe('function');
  });

  it('rasterizes the original deck to one image per slide', async () => {
    if (!(await isPreviewAvailable())) return; // bundled pptx-glimpse expected; skip if absent
    const tool = buildStudyOriginalTool(FIXTURE);
    const res = (await tool.handler({})) as {
      resultType: string;
      binaryResultsForLlm?: Array<{ type: string; mimeType: string; data: string }>;
    };
    expect(res.resultType).toBe('success');
    expect(res.binaryResultsForLlm).toHaveLength(3); // fixture has 3 slides
    for (const b of res.binaryResultsForLlm ?? []) {
      expect(b.type).toBe('image');
      expect(b.mimeType).toBe('image/png');
      expect(b.data.length).toBeGreaterThan(0);
    }
  });

  it('respects the slide cap', async () => {
    if (!(await isPreviewAvailable())) return;
    const tool = buildStudyOriginalTool(FIXTURE, 2);
    const res = (await tool.handler({})) as {
      resultType: string;
      binaryResultsForLlm?: unknown[];
    };
    expect(res.resultType).toBe('success');
    expect(res.binaryResultsForLlm).toHaveLength(2);
  });
});
