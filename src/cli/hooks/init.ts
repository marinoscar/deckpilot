import type { Hook } from '@oclif/core';

/**
 * Default to the `menu` command when no command (or only flags) is supplied.
 * `deckpilot` → `deckpilot menu`. Recognised top-level flags like --version
 * / --help are left alone.
 */
const hook: Hook<'init'> = async (_opts) => {
  // Default-command routing happens in bin/run.js (oclif v4 ignores argv
  // mutation in init hooks). This hook is kept as an extension point for
  // future per-init work (telemetry, deprecation banners, etc.).
};

export default hook;
