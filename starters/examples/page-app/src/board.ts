/**
 * The board's data model and the pure helpers around it. No React, no SDK.
 */

export const MAX_PINS = 48;
export const MAX_LABEL = 60;
export const MAX_NOTE = 200;

export interface Pin {
  modelId: number;
  label: string;
  note: string;
  /** Epoch ms. */
  addedAt: number;
}

export interface Board {
  pins: Pin[];
}

export const EMPTY_BOARD: Board = { pins: [] };

/**
 * A model id from what a viewer pastes: a bare id (`4201`) or a civitai model
 * URL (`https://civitai.com/models/4201/some-name?modelVersionId=…`). `null`
 * for anything else.
 */
export function parseModelId(input: string): number | null {
  const text = input.trim();
  const match = /^\d+$/.test(text) ? [text, text] : /\/models\/(\d+)(?:[/?#]|$)/.exec(text);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * This app's own routes, from `useCivitaiRoute()`: the segment below the app
 * root, no leading slash. `''` is the board itself.
 */
export type Route = { view: 'board' } | { view: 'pin'; modelId: number } | { view: 'missing' };

export function parseRoute(subPath: string): Route {
  if (subPath === '') return { view: 'board' };
  const pin = /^pin\/(\d+)$/.exec(subPath);
  if (pin) return { view: 'pin', modelId: Number(pin[1]) };
  return { view: 'missing' };
}
