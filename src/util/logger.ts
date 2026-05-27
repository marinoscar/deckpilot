const enabled = process.env.DECKPILOT_DEBUG === '1';

export const log = {
  debug(...args: unknown[]) {
    if (enabled) console.error('[deckpilot]', ...args);
  },
  warn(...args: unknown[]) {
    console.error('[deckpilot:warn]', ...args);
  },
};
