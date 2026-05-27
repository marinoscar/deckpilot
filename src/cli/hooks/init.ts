import type { Hook } from '@oclif/core';

/**
 * Default to the `chat` command when no command (or only flags) is supplied.
 * `deckpilot` → `deckpilot chat`.
 * Recognised top-level flags like --version / --help are left alone.
 */
const hook: Hook<'init'> = async (opts) => {
  const argv = opts.argv ?? [];
  if (opts.id) return;
  if (argv.length === 0) {
    opts.argv = ['chat'];
    return;
  }
  const first = argv[0];
  if (first === undefined) return;
  if (first.startsWith('-')) return;
  const known = new Set([
    'chat',
    'auth',
    'doctor',
    'help',
    'autocomplete',
    'version',
    'ver',
    'models',
    'render',
  ]);
  if (!known.has(first)) return;
};

export default hook;
