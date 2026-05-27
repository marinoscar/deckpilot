export type SlashCommand =
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'new' }
  | { kind: 'render'; outputPath?: string }
  | { kind: 'model'; id?: string }
  | { kind: 'models' }
  | { kind: 'quit' }
  | { kind: 'unknown'; raw: string };

export type SlashParseResult = SlashCommand | null;

const KNOWN: Record<string, SlashCommand['kind']> = {
  help: 'help',
  '?': 'help',
  clear: 'clear',
  new: 'new',
  render: 'render',
  model: 'model',
  models: 'models',
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
  if (kind === 'model') {
    return { kind: 'model', id: tail.join(' ').trim() || undefined };
  }
  return { kind } as SlashCommand;
}

export const HELP_TEXT = `
Slash commands:
  /help, /?         Show this help
  /clear            Clear the transcript (history reset)
  /new              Start fresh (clear + reset deck state)
  /model            Show the current LLM model
  /model <id>       Switch model (resets conversation — SDK can't carry state across sessions)
  /models           List available models
  /render [path]    Render a hardcoded sample 3-slide deck (M1 placeholder).
                    Path defaults to ./deckpilot-sample.pptx
  /quit, /exit      Exit DeckPilot

Anything not starting with / is sent to GitHub Copilot.
`.trim();
