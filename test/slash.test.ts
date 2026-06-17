import { describe, expect, it } from 'vitest';
import {
  HELP_TEXT,
  SLASH_COMMANDS,
  filterSlashCommands,
  parseSlash,
  slashLabel,
} from '../src/chat/slash.js';

describe('filterSlashCommands', () => {
  it('returns every command for an empty query', () => {
    expect(filterSlashCommands('')).toEqual(SLASH_COMMANDS);
    expect(filterSlashCommands('   ')).toEqual(SLASH_COMMANDS);
  });

  it('matches by name prefix, case-insensitively', () => {
    const names = filterSlashCommands('TE').map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['template', 'templates']));
    expect(names).not.toContain('render');
  });

  it('matches by alias prefix', () => {
    // `/img` is an alias of `image`; `/?` an alias of `help`.
    expect(filterSlashCommands('img').map((c) => c.name)).toContain('image');
    expect(filterSlashCommands('?').map((c) => c.name)).toContain('help');
  });

  it('returns nothing for an unknown prefix', () => {
    expect(filterSlashCommands('zzz')).toHaveLength(0);
  });
});

describe('slashLabel', () => {
  it('joins name + aliases and appends the args hint', () => {
    expect(slashLabel({ name: 'help', aliases: ['?'], summary: '' })).toBe('/help, /?');
    expect(slashLabel({ name: 'render', args: '[path]', summary: '' })).toBe('/render [path]');
  });
});

describe('registry ⇄ parser consistency', () => {
  it('every parseable command has a metadata entry', () => {
    // `image`/`doc` are handled in the prompt, not parseSlash, but still listed.
    for (const cmd of SLASH_COMMANDS) {
      const parsed = parseSlash(`/${cmd.name}`);
      if (cmd.name === 'image' || cmd.name === 'doc') continue;
      expect(parsed, `/${cmd.name} should parse`).not.toBeNull();
      expect(parsed?.kind).not.toBe('unknown');
    }
  });

  it('HELP_TEXT lists every command summary', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(HELP_TEXT).toContain(cmd.summary);
    }
  });
});
