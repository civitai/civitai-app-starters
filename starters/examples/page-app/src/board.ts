/**
 * The board's data model and the pure helpers around it. No React, no SDK.
 *
 * The whole board is ONE storage row under {@link BOARD_KEY}. One row per pin
 * would spend the per-(app, viewer) ROW budget (`APP_STORAGE_MAX_ROWS`) a pin at
 * a time; one JSON value spends bytes instead, and {@link MAX_PINS} x the field
 * caps below keeps it far under the per-value cap (`APP_STORAGE_MAX_VALUE_BYTES`).
 */

export const BOARD_KEY = 'board';
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
 * A stored value is whatever an earlier version of this app (or a hand-edited
 * row) wrote, so it is checked, not cast.
 */
export function readBoard(value: unknown): Board {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Board).pins)) return EMPTY_BOARD;
  const pins = (value as Board).pins.filter(
    (p): p is Pin =>
      !!p &&
      typeof p === 'object' &&
      Number.isSafeInteger(p.modelId) &&
      p.modelId > 0 &&
      typeof p.label === 'string' &&
      typeof p.note === 'string' &&
      typeof p.addedAt === 'number',
  );
  return { pins };
}

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
