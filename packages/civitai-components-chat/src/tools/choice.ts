import type { ChoiceOption } from '../types.js';

export interface Choice {
  question: string;
  options: ChoiceOption[];
}

export const CHOICE_MIN = 2;
export const CHOICE_MAX = 4;

/**
 * An `ask_choice` call's input as the card can show it, or `null` when it cannot be shown. The tool
 * and the thread both read the input through this one function, so a call the tool reports as shown
 * is one the card renders. Models sometimes send `options` as a JSON string instead of an array: one
 * that parses is accepted, anything else is not.
 */
export function normalizeChoice(input: unknown): Choice | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as { question?: unknown; options?: unknown };
  let options = record.options;
  if (typeof options === 'string') {
    try {
      options = JSON.parse(options);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(options) || options.length < CHOICE_MIN || options.length > CHOICE_MAX) return null;
  const parsed: ChoiceOption[] = [];
  for (const option of options) {
    if (!option || typeof option !== 'object') return null;
    const { label, description, image } = option as { label?: unknown; description?: unknown; image?: unknown };
    if (typeof label !== 'string' || label.trim() === '') return null;
    parsed.push({
      label,
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(typeof image === 'string' && image !== '' ? { image } : {}),
    });
  }
  return { question: typeof record.question === 'string' ? record.question : '', options: parsed };
}

export const CHOICE_INVALID = `options must be an array of ${CHOICE_MIN} to ${CHOICE_MAX} objects, each with a "label" string.`;
export const CHOICE_RETRY_NOTE = 'Nothing was shown. Call ask_choice again with options as an array.';
