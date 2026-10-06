import type { ChatModelOption } from '../config.js';

export interface ChatCommand {
  name: string;
  aliases?: string[];
  usage: string;
  help: string;
}

export const COMMANDS: ChatCommand[] = [
  { name: 'clear', aliases: ['new'], usage: '/clear', help: 'Start a new chat' },
  { name: 'model', usage: '/model [default | smart | model id]', help: "Show or switch the assistant's model" },
  { name: 'help', usage: '/help', help: 'List these commands' },
];

export type ParsedCommand = { command: ChatCommand; arg: string } | { unknown: string };

/** A message that starts with `/name` is a command for the chat, never sent to the assistant. */
export function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const command = COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
  return command ? { command, arg: (match[2] ?? '').trim() } : { unknown: name };
}

/** Commands the typed `/prefix` could become, for suggestions while typing. */
export function suggestCommands(text: string): ChatCommand[] {
  const match = /^\/([\w-]*)$/.exec(text);
  if (!match) return [];
  const prefix = match[1]!.toLowerCase();
  return COMMANDS.filter((c) => [c.name, ...(c.aliases ?? [])].some((name) => name.startsWith(prefix)));
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
