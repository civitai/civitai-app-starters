import { CUSTOM_INSTRUCTIONS_MAX } from '../config.js';

export const UPDATE_INSTRUCTIONS = 'update_instructions';

/** The instructions a call proposes, trimmed; `undefined` when there are none to show. */
export function proposedInstructions(input: unknown): string | undefined {
  const text = (input as { instructions?: unknown } | null)?.instructions;
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  return trimmed && trimmed.length <= CUSTOM_INSTRUCTIONS_MAX ? trimmed : undefined;
}
