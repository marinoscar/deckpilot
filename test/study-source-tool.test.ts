import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPreviewAvailable } from '../src/render/pptx-to-pngs.js';
import { buildSaveImprovementPlanTool, buildStudySourceTool } from '../src/tools/extract.js';

const FIXTURE = join(__dirname, 'fixtures', 'sample-branded.pptx');

describe('buildStudySourceTool', () => {
  it('defines a study_source_slides tool with no parameters', () => {
    const tool = buildStudySourceTool(FIXTURE);
    expect(tool.name).toBe('study_source_slides');
    expect(typeof tool.handler).toBe('function');
  });

  it('rasterizes the source deck to one image per slide', async () => {
    if (!(await isPreviewAvailable())) return; // bundled pptx-glimpse expected; skip if absent
    const tool = buildStudySourceTool(FIXTURE);
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
    const tool = buildStudySourceTool(FIXTURE, 2);
    const res = (await tool.handler({})) as {
      resultType: string;
      binaryResultsForLlm?: unknown[];
    };
    expect(res.resultType).toBe('success');
    expect(res.binaryResultsForLlm).toHaveLength(2);
  });
});

describe('buildSaveImprovementPlanTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deckpilot-plan-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes IMPROVEMENT-PLAN.md into the project root', async () => {
    const tool = buildSaveImprovementPlanTool(() => dir);
    const res = (await tool.handler({
      summary: 'The deck buries its thesis and over-relies on bullet lists.',
      recommendations: [
        { slide: 'cover', issue: 'Generic title.', fix: 'Lead with the specific outcome.' },
        { slide: '2-3', issue: 'Wall of text.', fix: 'Split into a claim + supporting visual.' },
      ],
    })) as { ok: boolean; message?: string };
    expect(res.ok).toBe(true);
    const md = readFileSync(join(dir, 'IMPROVEMENT-PLAN.md'), 'utf8');
    expect(md).toMatch(/# Improvement plan/);
    expect(md).toMatch(/Generic title/);
    expect(md).toMatch(/Slide 2-3/);
  });

  it('rejects an empty recommendation set', async () => {
    const tool = buildSaveImprovementPlanTool(() => dir);
    const res = (await tool.handler({ summary: 'ok', recommendations: [] })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});
