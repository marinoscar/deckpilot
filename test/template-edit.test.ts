import { describe, expect, it } from 'vitest';
import { blankTemplate } from '../src/template/spec.js';
import {
  TemplatePatchError,
  applyOnePatch,
  applyPatches,
  listSettableKeys,
} from '../src/util/template-patch.js';

describe('applyOnePatch', () => {
  const spec = blankTemplate('acme');

  it('updates a top-level scalar', () => {
    const next = applyOnePatch(spec, 'brand', 'Acme Corp');
    expect(next.brand).toBe('Acme Corp');
  });

  it('clears a value when assigned ""', () => {
    const withDesc = applyOnePatch(spec, 'description', 'hi');
    const cleared = applyOnePatch(withDesc, 'description', '');
    expect(cleared.description).toBeUndefined();
  });

  it('updates a theme hex value (validated later by applyPatches)', () => {
    const next = applyOnePatch(spec, 'theme.accent', 'ABCDEF');
    expect(next.theme.accent).toBe('ABCDEF');
  });

  it('rejects an invalid tone', () => {
    expect(() => applyOnePatch(spec, 'theme.tone', 'sparkly')).toThrow(TemplatePatchError);
  });

  it('rejects an invalid aspect', () => {
    expect(() => applyOnePatch(spec, 'theme.aspect', '21:9')).toThrow(TemplatePatchError);
  });

  it('rejects unknown key paths', () => {
    expect(() => applyOnePatch(spec, 'foo', 'bar')).toThrow(TemplatePatchError);
    expect(() => applyOnePatch(spec, 'theme.somethingElse', 'bar')).toThrow(TemplatePatchError);
  });

  it('honours kebab aliases for camelCase keys', () => {
    const next = applyOnePatch(spec, 'voice-hints', 'be friendly');
    expect(next.voiceHints).toBe('be friendly');
  });
});

describe('applyPatches', () => {
  const spec = blankTemplate('acme');

  it('applies multiple patches in order', () => {
    const out = applyPatches(spec, [
      'brand=Acme Corp',
      'theme.accent=ABCDEF',
      'theme.tone=playful',
    ]);
    expect(out.brand).toBe('Acme Corp');
    expect(out.theme.accent).toBe('ABCDEF');
    expect(out.theme.tone).toBe('playful');
  });

  it('validates the final spec via TemplateSpecSchema', () => {
    expect(() => applyPatches(spec, ['theme.accent=NOTHEX'])).toThrow(TemplatePatchError);
  });

  it('rejects bad patch strings without "="', () => {
    expect(() => applyPatches(spec, ['no-equals-here'])).toThrow(TemplatePatchError);
  });
});

describe('listSettableKeys', () => {
  it('includes every known top-level + theme + assets path', () => {
    const keys = listSettableKeys();
    expect(keys).toContain('brand');
    expect(keys).toContain('theme.accent');
    expect(keys).toContain('theme.tone');
    expect(keys).toContain('assets.logo');
  });
});

describe('donorGeometry array-index patches', () => {
  const spec = {
    ...blankTemplate('with-donors'),
    donorGeometry: [
      { index: 0, name: 'Slide 1', summary: '', shapes: [] },
      { index: 1, name: 'Slide 2', summary: 'old', shapes: [] },
    ],
  };

  it('updates donorGeometry[N].summary via --set syntax', () => {
    const next = applyPatches(spec, [
      'donorGeometry[0].summary=Cover slide with photo backdrop',
    ]);
    expect(next.donorGeometry?.[0].summary).toBe('Cover slide with photo backdrop');
    expect(next.donorGeometry?.[1].summary).toBe('old');
  });

  it('rejects out-of-range indices', () => {
    expect(() =>
      applyPatches(spec, ['donorGeometry[9].summary=oops']),
    ).toThrow(TemplatePatchError);
  });

  it('rejects when donorGeometry is absent', () => {
    const bare = blankTemplate('bare');
    expect(() =>
      applyPatches(bare, ['donorGeometry[0].summary=anything']),
    ).toThrow(TemplatePatchError);
  });
});
