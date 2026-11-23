/**
 * The half of the mock host's `bytes` rules that needs the zip VALIDATOR — the
 * host's `classifySaveBytesContent` and `prepareSaveBytes` — plus the loader for
 * that validator.
 *
 * 🔴 NO STATIC import of `@civitai/app-sdk/save-zip`, here or anywhere in this
 * package's `src/`. That subpath first ships in app-sdk 0.85.0, above the peer
 * floor (>=0.57.0), and a static import fails at MODULE LOAD
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED`) on every older app-sdk the floor admits:
 * from the main entry it breaks `import '@civitai/blocks-react'`, and from
 * `createMockHost` it breaks `import '@civitai/blocks-react/testing'` — every
 * downstream test suite, the #344 shape. So the validator is loaded LAZILY
 * ({@link loadSaveZipRules}), only when the mock host is handed a buffer that
 * starts like a zip, and on an older app-sdk only that save is refused, with
 * {@link SAVE_ZIP_NEEDS_NEWER_APP_SDK_ERROR}. test/mainEntryNoSaveZip.test.ts
 * checks the BUILT entries: none imports it statically, and only `./testing`
 * reaches it at all.
 *
 * The same holds for `@civitai/app-sdk/save-model3d`, the binary glTF / FBX
 * check: loaded lazily ({@link loadSaveModel3dRules}) on the first save that
 * starts like a model, refused with {@link SAVE_MODEL3D_NEEDS_NEWER_APP_SDK_ERROR}
 * on an app-sdk without it, and covered by the same built-entry test.
 */

import {
  SAVE_BYTES_TOO_LARGE_ERROR,
  SAVE_BYTES_TYPE_NOT_ALLOWED_ERROR,
  forceSaveBytesExtension,
  sanitizeSaveBytesFilename,
  saveBytesMaxBytes,
  sniffImageBytes,
  startsLikeModel3d,
  startsLikeZip,
  type SaveBytesType,
} from './saveBytes.js';

/** A deflated entry the inflate check must inflate (`@civitai/app-sdk/save-zip`'s `SaveZipDeflatedEntry`). */
export type SaveZipDeflatedEntry = { dataOffset: number; compressedSize: number; size: number; crc: number };

/**
 * The part of `@civitai/app-sdk/save-zip` the mock host calls. Declared
 * structurally so no TYPE import of the subpath reaches this package's `.d.ts`
 * either; {@link loadSaveZipRules} assigns the real module to it, so a change
 * to the real signatures fails this package's typecheck.
 */
export type SaveZipRules = {
  validateSaveZip(
    bytes: ArrayBuffer,
  ): { ok: true; entryCount: number; deflated: SaveZipDeflatedEntry[] } | { ok: false; error: string };
  verifySaveZipInflate(bytes: ArrayBuffer, deflated: readonly SaveZipDeflatedEntry[]): Promise<string | null>;
  SAVE_ZIP_INFLATE_ERROR: string;
};

/** The mock host's reply to a zip save when the installed app-sdk has no `./save-zip`. */
export const SAVE_ZIP_NEEDS_NEWER_APP_SDK_ERROR =
  'createMockHost validates a zip with @civitai/app-sdk/save-zip, which needs @civitai/app-sdk >= 0.85.0';

let rules: Promise<SaveZipRules> | undefined;

/**
 * Load the validator once, on the first zip save. Rejects on an app-sdk without `./save-zip`.
 *
 * Declared WITHOUT `export` and exported by name below, on purpose: the peer-floor guard
 * (tests/guards/blocks-react-peer-floor.test.mjs) reads `export … '<specifier>'` up to the first
 * quote as a static import, so `export function` directly above this `import('…')` would be
 * counted as a module-load import of `./save-zip`. The specifier must stay a LITERAL — a
 * bundler resolves a dynamic import only when it can read its argument.
 */
function loadSaveZipRules(): Promise<SaveZipRules> {
  rules ??= import('@civitai/app-sdk/save-zip').then((m): SaveZipRules => m);
  // A failed load is not cached: the next zip save tries again (and fails the same way).
  rules.catch(() => {
    rules = undefined;
  });
  return rules;
}
export { loadSaveZipRules };

/** `verifySaveZipInflate`, with a throw read as the host reads it: the entry does not inflate. */
export async function verifySaveZipInflateSafely(
  zip: SaveZipRules,
  bytes: ArrayBuffer,
  deflated: readonly SaveZipDeflatedEntry[],
): Promise<string | null> {
  try {
    return await zip.verifySaveZipInflate(bytes, deflated);
  } catch {
    return zip.SAVE_ZIP_INFLATE_ERROR;
  }
}

/** The model types `@civitai/app-sdk/save-model3d` classifies (its `SaveModel3dType`). */
export type SaveModel3dType = 'model/gltf-binary' | 'model/x-fbx';

/**
 * The part of `@civitai/app-sdk/save-model3d` the mock host calls, declared structurally for the
 * same reason as {@link SaveZipRules}; {@link loadSaveModel3dRules} assigns the real module to it.
 */
export type SaveModel3dRules = {
  looksLikeSaveModel3d(view: Uint8Array): SaveModel3dType | null;
  isValidSaveModel3d(view: Uint8Array, type: SaveModel3dType): boolean;
};

/**
 * The mock host's reply to a 3D model save when the installed app-sdk has no `./save-model3d`.
 * It names no version: the subpath ships in the app-sdk release after 0.92.0.
 */
export const SAVE_MODEL3D_NEEDS_NEWER_APP_SDK_ERROR =
  'createMockHost checks a 3D model with @civitai/app-sdk/save-model3d, which the installed @civitai/app-sdk does not have';

let model3dRules: Promise<SaveModel3dRules> | undefined;

/**
 * Load the 3D model check once, on the first model save — {@link loadSaveZipRules}'s shape and
 * reasons (not exported inline, a LITERAL specifier, a failed load not cached).
 */
function loadSaveModel3dRules(): Promise<SaveModel3dRules> {
  model3dRules ??= import('@civitai/app-sdk/save-model3d').then((m): SaveModel3dRules => m);
  model3dRules.catch(() => {
    model3dRules = undefined;
  });
  return model3dRules;
}
export { loadSaveModel3dRules };

/**
 * Does this request need the 3D model check — a buffer under its cap that is not an image or a
 * zip and STARTS like a binary glTF / FBX?
 */
export function saveBytesNeedsModel3dRules(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength > saveBytesMaxBytes(bytes)) return false;
  const view = new Uint8Array(bytes);
  return !sniffImageBytes(view) && !startsLikeZip(view) && startsLikeModel3d(view);
}

/**
 * Does this request need the zip validator — a buffer under its cap that is not
 * an image and STARTS like a zip? Everything else is decided without it.
 */
export function saveBytesNeedsZipRules(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength > saveBytesMaxBytes(bytes)) return false;
  const view = new Uint8Array(bytes);
  return !sniffImageBytes(view) && startsLikeZip(view);
}

/**
 * Classify a `bytes` payload by CONTENT, with the refusal reason — the host's
 * `classifySaveBytesContent`: an image by magic bytes first (so a PNG with a zip
 * appended is a PNG); then a buffer that STARTS like a zip must pass the zip
 * validator (`@civitai/app-sdk/save-zip`, the module the host imports) and is
 * refused with the zip's own reason otherwise; then a buffer that STARTS like a
 * binary glTF / FBX must pass `@civitai/app-sdk/save-model3d` (the module the host
 * imports) and is refused `file type is not allowed` otherwise; then text.
 */
export function classifySaveBytesContent(
  bytes: ArrayBuffer,
  filename: string,
  zip: Pick<SaveZipRules, 'validateSaveZip'> | null,
  model3d: SaveModel3dRules | null = null,
):
  | { ok: true; type: Exclude<SaveBytesType, 'application/zip'> }
  | { ok: true; type: 'application/zip'; deflated: SaveZipDeflatedEntry[] }
  | { ok: false; error: string } {
  const view = new Uint8Array(bytes);
  const image = sniffImageBytes(view);
  if (image) return { ok: true, type: image };
  if (startsLikeZip(view)) {
    if (!zip) throw new Error('classifySaveBytesContent: a zip candidate needs the zip rules (loadSaveZipRules)');
    const v = zip.validateSaveZip(bytes);
    if (!v.ok) return v;
    return { ok: true, type: 'application/zip', deflated: v.deflated };
  }
  if (startsLikeModel3d(view)) {
    if (!model3d) {
      throw new Error('classifySaveBytesContent: a 3D model candidate needs the model rules (loadSaveModel3dRules)');
    }
    const model = model3d.looksLikeSaveModel3d(view);
    return model && model3d.isValidSaveModel3d(view, model)
      ? { ok: true, type: model }
      : { ok: false, error: SAVE_BYTES_TYPE_NOT_ALLOWED_ERROR };
  }
  const text = classifySaveBytesText(view, filename);
  return text ? { ok: true, type: text } : { ok: false, error: SAVE_BYTES_TYPE_NOT_ALLOWED_ERROR };
}

/**
 * The text step of {@link classifySaveBytesContent} — the host's
 * `classifySaveBytesText`. `filename` is the only hint and must already be
 * CLEANED ({@link sanitizeSaveBytesFilename}): a name ending `.json`
 * (case-insensitive) chooses JSON over text/plain for bytes that already parse
 * as JSON, and it can never make a binary payload acceptable. `null` = not text
 * (`file type is not allowed`).
 */
function classifySaveBytesText(view: Uint8Array, filename: string): 'application/json' | 'text/plain' | null {
  if (view.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return null; // not valid UTF-8 — random binary, a GIF, …
  }
  if (filename.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(text);
      return 'application/json';
    } catch {
      // A `.json` name on text that does not parse saves as text, not a refusal.
    }
  }
  return 'text/plain';
}

/**
 * Size-cap, clean the name, classify on the CLEANED name, and force the
 * extension — the host's `prepareSaveBytes`, in its order. Every refusal is the
 * reply's error string. An accepted zip also carries the deflated entries the
 * host inflate-checks before it downloads (`verifySaveZipInflate`). `zip` may be
 * `null` only when {@link saveBytesNeedsZipRules} is false, and `model3d` only
 * when {@link saveBytesNeedsModel3dRules} is false.
 */
export function prepareSaveBytes(
  req: { bytes: ArrayBuffer; filename?: string },
  zip: Pick<SaveZipRules, 'validateSaveZip'> | null,
  model3d: SaveModel3dRules | null = null,
):
  | { ok: true; type: SaveBytesType; filename: string; deflated?: SaveZipDeflatedEntry[] }
  | { ok: false; error: string } {
  if (req.bytes.byteLength > saveBytesMaxBytes(req.bytes)) {
    return { ok: false, error: SAVE_BYTES_TOO_LARGE_ERROR };
  }
  const filename = sanitizeSaveBytesFilename(req.filename);
  const c = classifySaveBytesContent(req.bytes, filename, zip, model3d);
  if (!c.ok) return c;
  const name = forceSaveBytesExtension(filename, c.type);
  if (c.type === 'application/zip') return { ok: true, type: c.type, filename: name, deflated: c.deflated };
  return { ok: true, type: c.type, filename: name };
}
