export type SlashCommand =
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'new' }
  | { kind: 'render'; outputPath?: string }
  | { kind: 'save'; projectName?: string }
  | { kind: 'outline' }
  | { kind: 'show' }
  | { kind: 'undo' }
  | { kind: 'model'; id?: string }
  | { kind: 'models' }
  | { kind: 'template'; arg?: string }
  | { kind: 'templates' }
  | { kind: 'project'; arg?: string }
  | { kind: 'load'; path?: string }
  | { kind: 'critique'; slideId?: string }
  | { kind: 'critique-passes'; n?: number }
  | { kind: 'style-guide' }
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
  templates: 'templates',
  project: 'project',
  load: 'load',
  critique: 'critique',
  'critique-passes': 'critique-passes',
  'style-guide': 'style-guide',
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
    return { kind: 'save', projectName: tail.join(' ').trim() || undefined };
  }
  if (kind === 'model') {
    return { kind: 'model', id: tail.join(' ').trim() || undefined };
  }
  if (kind === 'template') {
    return { kind: 'template', arg: tail.join(' ').trim() || undefined };
  }
  if (kind === 'project') {
    return { kind: 'project', arg: tail.join(' ').trim() || undefined };
  }
  if (kind === 'load') {
    return { kind: 'load', path: tail.join(' ') || undefined };
  }
  if (kind === 'critique') {
    return { kind: 'critique', slideId: tail.join(' ').trim() || undefined };
  }
  if (kind === 'critique-passes') {
    const raw = tail.join(' ').trim();
    const parsed = raw ? Number.parseInt(raw, 10) : undefined;
    return { kind: 'critique-passes', n: Number.isNaN(parsed) ? undefined : parsed };
  }
  return { kind } as SlashCommand;
}

export const HELP_TEXT = `
Slash commands:
  /help, /?           Show this help
  /outline            Compact outline of the current brief (titles + purposes)
  /show               Full DeckBrief as JSON
  /render [path]      Render the current deck to .pptx (default: ./<title>.pptx)
  /save               Force-flush autosave (the deck saves to ~/.deckpilot/ automatically)
  /save <name>        Rename the current project + flush
  /load <path>        Load a previously-saved .brief.json into the current project
  /project            Show the current project name + path
  /project <name>     Rename the current project on disk
  /templates          List every saved named template (under ~/.deckpilot/templates/)
  /template           Show the currently-applied template
  /template <name>    Switch to a different saved template
  /template <path>    Inherit theme + fonts one-shot from a .pptx (no save)
  /template none      Clear the active template
  /critique <id>      Force the LLM to re-preview a specific slide (resets its budget)
  /critique-passes <n>  Set how many preview passes per slide (0 disables, max 5)
  /style-guide        Show the active DECKPILOT.md (or note that none was found)
  /undo               Roll back the most recent deck change
  /clear              Clear the transcript (keep the deck)
  /new                Clear the transcript and decouple from the current project
  /model              Show the current LLM model
  /model <id>         Switch model (history preserved by the SDK)
  /models             List available models
  /quit, /exit        Exit DeckPilot

Decks autosave to ~/.deckpilot/projects/<name>/ every few seconds. Resume any
saved project anywhere with: deckpilot resume <name>. Run "deckpilot" with no
arguments to open the main menu where you can manage projects, templates,
and settings.

Type "@" in the prompt to insert a path to a .pptx or .brief.json in the
current directory (handy for /template, /load, or referencing files in chat).

Anything not starting with / is sent to GitHub Copilot.
`.trim();
