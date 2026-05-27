export type SlashCommand =
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'new' }
  | { kind: 'render'; outputPath?: string }
  | { kind: 'save'; outputPath?: string }
  | { kind: 'outline' }
  | { kind: 'show' }
  | { kind: 'undo' }
  | { kind: 'model'; id?: string }
  | { kind: 'models' }
  | { kind: 'template'; path?: string }
  | { kind: 'load'; path?: string }
  | { kind: 'quit' }
  | { kind: 'unknown'; raw: string };

export type SlashParseResult = SlashCommand | null;

const KNOWN: Record<string, SlashCommand['kind']> = {
  help: 'help',
  '?': 'help',
  clear: 'clear',
  new: 'new',
  render: 'render',
  save: 'save',
  outline: 'outline',
  show: 'show',
  undo: 'undo',
  model: 'model',
  models: 'models',
  template: 'template',
  load: 'load',
  quit: 'quit',
  exit: 'quit',
};

export function parseSlash(input: string): SlashParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const rest = trimmed.slice(1);
  const [head, ...tail] = rest.split(/\s+/);
  const kind = KNOWN[head?.toLowerCase() ?? ''];
  if (!kind) return { kind: 'unknown', raw: trimmed };
  if (kind === 'render') {
    return { kind: 'render', outputPath: tail.join(' ') || undefined };
  }
  if (kind === 'save') {
    return { kind: 'save', outputPath: tail.join(' ') || undefined };
  }
  if (kind === 'model') {
    return { kind: 'model', id: tail.join(' ').trim() || undefined };
  }
  if (kind === 'template') {
    return { kind: 'template', path: tail.join(' ') || undefined };
  }
  if (kind === 'load') {
    return { kind: 'load', path: tail.join(' ') || undefined };
  }
  return { kind } as SlashCommand;
}

export const HELP_TEXT = `
Slash commands:
  /help, /?         Show this help
  /outline          Compact outline of the current deck (titles + bullet counts)
  /show             Full plan as JSON
  /render [path]    Render the current plan to .pptx (default: ./<title>.pptx)
  /save [path]      Render + save a plan.json next to it (for later re-editing)
  /load <path>      Load a previously-saved .plan.json as the working plan
  /template <path>  Inherit theme + fonts from an existing .pptx (style only)
  /template         Show the currently-loaded template
  /undo             Roll back the most recent plan change
  /clear            Clear the transcript (keep the deck)
  /new              Reset everything (transcript and deck)
  /model            Show the current LLM model
  /model <id>       Switch model (history preserved by the SDK)
  /models           List available models
  /quit, /exit      Exit DeckPilot

Type "@" in the prompt to insert a path to a .pptx or .plan.json in the current
directory (handy for /template, /load, or just referencing files in chat).

Anything not starting with / is sent to GitHub Copilot.
`.trim();
