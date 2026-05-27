#!/usr/bin/env node
import { execute } from '@oclif/core';

// If invoked with no arguments, default to the interactive menu. This keeps
// `deckpilot` ergonomic at the prompt while preserving all subcommands.
// Done at the runner level because oclif v4 ignores argv mutations in init hooks.
if (process.argv.length <= 2) {
  process.argv.push('menu');
}

await execute({ dir: import.meta.url });
