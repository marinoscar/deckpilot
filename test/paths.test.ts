import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  homeRoot,
  projectDir,
  projectsRoot,
  slugify,
  templateDir,
  templatesRoot,
} from '../src/store/paths.js';

describe('paths', () => {
  const original = process.env.DECKPILOT_HOME;
  beforeEach(() => {
    delete process.env.DECKPILOT_HOME;
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env.DECKPILOT_HOME;
    } else {
      process.env.DECKPILOT_HOME = original;
    }
  });

  it('defaults to ~/.deckpilot when DECKPILOT_HOME is unset', () => {
    expect(homeRoot()).toBe(join(homedir(), '.deckpilot'));
  });

  it('honours DECKPILOT_HOME when set', () => {
    process.env.DECKPILOT_HOME = '/tmp/deckpilot-test-home';
    expect(homeRoot()).toBe('/tmp/deckpilot-test-home');
    expect(projectsRoot()).toBe('/tmp/deckpilot-test-home/projects');
    expect(templatesRoot()).toBe('/tmp/deckpilot-test-home/templates');
    expect(projectDir('foo')).toBe('/tmp/deckpilot-test-home/projects/foo');
    expect(templateDir('acme')).toBe('/tmp/deckpilot-test-home/templates/acme');
  });

  it('treats whitespace-only DECKPILOT_HOME as unset', () => {
    process.env.DECKPILOT_HOME = '   ';
    expect(homeRoot()).toBe(join(homedir(), '.deckpilot'));
  });
});

describe('slugify', () => {
  it('lowercases and replaces runs of non-alphanumeric with single dashes', () => {
    expect(slugify('Acme Corp Pitch!')).toBe('acme-corp-pitch');
  });
  it('strips leading/trailing dashes', () => {
    expect(slugify('   ---Hello World---   ')).toBe('hello-world');
  });
  it('returns "" for empty / unusable input', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
  it('caps at 64 characters', () => {
    expect(slugify('a'.repeat(200)).length).toBe(64);
  });
});
