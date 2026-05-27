import Start from './start.js';

/**
 * `deckpilot chat` — deprecated alias for `deckpilot start`. Both commands
 * are kept in the CLI surface so existing muscle memory works; the canonical
 * name is now `start`.
 */
export default class Chat extends Start {
  static override description =
    'Alias for `deckpilot start`. Kept for back-compat; prefer `start` going forward.';

  static override hidden = false;
}
