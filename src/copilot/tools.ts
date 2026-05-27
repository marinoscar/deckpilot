import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';

/**
 * M1: no LLM-callable deck tools yet — rendering is invoked locally by the
 * `/render` slash command. M2 introduces propose_outline, revise_slide,
 * render_deck, save_deck etc., wired here.
 */
export function buildToolRegistry(): Tool[] {
  return [
    defineTool('deckpilot_ping', {
      description:
        'Sanity-check tool. The model can call this to confirm DeckPilot tool wiring is functional. Returns "pong".',
      handler: async () => ({ ok: true, message: 'pong' }),
      skipPermission: true,
    }),
  ];
}
