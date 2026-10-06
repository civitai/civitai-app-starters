import type { ChatModelOption } from '../config.js';

export interface ChatCommandContext {
  /** The open conversation, if any. */
  conversationId?: string;
  /** Sends a message as the viewer, as if typed (it is never read as a command). */
  send(text: string): Promise<void>;
  /** Puts text in the message box for the viewer to finish or send. */
  compose(text: string): void;
  /** Shows a short note to the viewer. */
  notify(message: string): void;
}

/** A slash command, by name in a {@link ChatCommands} record; the viewer types `/name` with an optional argument. */
export interface ChatCommand {
  /** Shown in suggestions and /help, e.g. "/pin [name]". */
  usage: string;
  help: string;
  aliases?: string[];
  run(arg: string, context: ChatCommandContext): unknown;
}

export type ChatCommands = Record<string, ChatCommand>;

/**
 * A page's commands: a record merged over the built-ins (a name replaces one, `null` removes it), or a
 * function from the built-ins to the whole set.
 */
export type ChatCommandsOption = Record<string, ChatCommand | null | undefined> | ((defaults: ChatCommands) => ChatCommands);

const NAME = /^[a-z][\w-]{0,31}$/i;

export function resolveCommands(defaults: ChatCommands, option: ChatCommandsOption | undefined): ChatCommands {
  const merged = typeof option === 'function' ? option({ ...defaults }) : { ...defaults, ...option };
  const usable = Object.entries(merged).filter((entry): entry is [string, ChatCommand] => {
    const [name, command] = entry;
    if (!command) return false;
    if (NAME.test(name) && typeof command.run === 'function') return true;
    console.warn(`[chat-cvt] slash command "${name}" is skipped: names are a letter then letters, digits, _ or -, and it needs a run function`);
    return false;
  });
  return Object.fromEntries(usable.map(([name, command]) => [name.toLowerCase(), command]));
}

export type ParsedCommand = { name: string; command: ChatCommand; arg: string } | { unknown: string };

/** A message that starts with `/name` is a command for the chat, never sent to the assistant. */
export function parseCommand(text: string, commands: ChatCommands): ParsedCommand | null {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const typed = match[1]!.toLowerCase();
  const found = Object.entries(commands).find(([name, command]) => name === typed || command.aliases?.some((alias) => alias.toLowerCase() === typed));
  return found ? { name: found[0], command: found[1], arg: (match[2] ?? '').trim() } : { unknown: typed };
}

/** Commands the typed `/prefix` could become, for suggestions while typing. */
export function suggestCommands(text: string, commands: ChatCommands): { name: string; command: ChatCommand }[] {
  const match = /^\/([\w-]*)$/.exec(text);
  if (!match) return [];
  const prefix = match[1]!.toLowerCase();
  return Object.entries(commands)
    .filter(([name, command]) => [name, ...(command.aliases ?? [])].some((candidate) => candidate.toLowerCase().startsWith(prefix)))
    .map(([name, command]) => ({ name, command }));
}

/** `default` (or nothing) is the configured model; a listed label or id picks that model; anything else is taken as a model id. */
export function resolveModel(arg: string, options: ChatModelOption[]): string | undefined {
  const wanted = arg.trim();
  if (wanted === '' || wanted.toLowerCase() === 'default') return undefined;
  return options.find((option) => option.label.toLowerCase() === wanted.toLowerCase() || option.id === wanted)?.id ?? wanted;
}

export function modelName(id: string | undefined, options: ChatModelOption[]): string {
  if (!id) return 'Default';
  const option = options.find((o) => o.id === id);
  return option ? `${option.label} (${option.id})` : id;
}
