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
  | { kind: 'context' }
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
  context: 'context',
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

/**
 * Per-command metadata — the single source of truth that drives the `/`
 * autocomplete dropdown, the tips footer, and the generated HELP_TEXT below.
 * Keep this in sync with the SlashCommand union + KNOWN map above (and the
 * `/image`/`/doc` pickers, which are handled in the prompt rather than
 * parseSlash but still belong in the menu).
 */
export type SlashCommandMeta = {
  /** Canonical command name, without the leading slash (e.g. 'render'). */
  name: string;
  /** Alternative names that resolve to the same command (e.g. ['?'] for help). */
  aliases?: string[];
  /** Argument hint shown after the name; its presence means "takes arguments". */
  args?: string;
  /** One-line description shown in the dropdown and HELP_TEXT. */
  summary: string;
};

export const SLASH_COMMANDS: SlashCommandMeta[] = [
  { name: 'help', aliases: ['?'], summary: 'Show this help' },
  { name: 'outline', summary: 'Compact outline of the current brief (titles + purposes)' },
  { name: 'show', summary: 'Full DeckBrief as JSON' },
  {
    name: 'render',
    args: '[path]',
    summary: 'Render the current deck to .pptx (default: ./<title>.pptx)',
  },
  { name: 'save', args: '[name]', summary: 'Force-flush autosave (optionally rename the project)' },
  { name: 'load', args: '<path>', summary: 'Load a previously-saved .brief.json into the project' },
  {
    name: 'project',
    args: '[name]',
    summary: 'Show the current project name + path, or rename it',
  },
  { name: 'templates', summary: 'List every saved named template' },
  {
    name: 'template',
    args: '[name|path|none]',
    summary: 'Show, switch, one-shot inherit, or clear the template',
  },
  {
    name: 'critique',
    args: '<id>',
    summary: 'Force the LLM to re-preview a slide (resets its budget)',
  },
  {
    name: 'critique-passes',
    args: '<n>',
    summary: 'Set how many preview passes per slide (0 disables, max 5)',
  },
  { name: 'style-guide', summary: 'Show the active DECKPILOT.md (or note none was found)' },
  {
    name: 'image',
    aliases: ['img'],
    summary: 'Attach image files as visual references (multi-select)',
  },
  {
    name: 'doc',
    aliases: ['docs'],
    summary: 'Attach document files as text context (multi-select)',
  },
  { name: 'undo', summary: 'Roll back the most recent deck change' },
  { name: 'clear', summary: 'Clear the transcript (keep the deck)' },
  { name: 'new', summary: 'Clear the transcript and decouple from the project' },
  { name: 'model', args: '[id]', summary: 'Show the current LLM model, or switch it' },
  { name: 'models', summary: 'List available models' },
  {
    name: 'context',
    summary: 'Show GitHub Copilot context-window usage + this session’s token spend',
  },
  { name: 'quit', aliases: ['exit'], summary: 'Exit DeckPilot' },
];

/** Full left-hand label for a command, e.g. `/save, /s [name]`. */
export function slashLabel(cmd: SlashCommandMeta): string {
  const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => `/${n}`).join(', ');
  return cmd.args ? `${names} ${cmd.args}` : names;
}

/**
 * Commands whose name or any alias starts with `query` (case-insensitive).
 * `query` is the text after the leading `/` (may be empty → all commands).
 */
export function filterSlashCommands(query: string): SlashCommandMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) =>
    [cmd.name, ...(cmd.aliases ?? [])].some((n) => n.toLowerCase().startsWith(q)),
  );
}

/** The aligned "Slash commands:" block, generated from SLASH_COMMANDS. */
const COMMAND_LIST = (() => {
  const labels = SLASH_COMMANDS.map(slashLabel);
  const width = Math.max(...labels.map((l) => l.length));
  return SLASH_COMMANDS.map((cmd, i) => `  ${labels[i].padEnd(width)}  ${cmd.summary}`).join('\n');
})();

export const HELP_TEXT = `
Slash commands:
${COMMAND_LIST}

Decks autosave to ~/.deckpilot/projects/<name>/ every few seconds. Resume any
saved project anywhere with: deckpilot resume <name>. Run "deckpilot" with no
arguments to open the main menu where you can manage projects, templates,
and settings.

Type "@" in the prompt to insert a path to a .pptx or .brief.json in the
current directory (handy for /template, /load, or referencing files in chat).
Type "/image" to attach image files (png/jpg/gif/webp) from this folder as
visual references the model can actually see — they're sent with your next
message. Staged images show above the prompt; Esc on an empty line clears them.
Type "/doc" to attach document files (.txt/.md/.pptx/.docx) — their text is
extracted and injected as reference context with your next message, and stays
in the conversation for the rest of the session.

Anything not starting with / is sent to GitHub Copilot.
`.trim();
