/**
 * The host's two limits on a PASS-THROUGH step `input` — a `kind: 'step'` body
 * with no `step` id, and every step of a `kind: 'workflow'` body. A MIRROR of
 * civitai/civitai `src/server/schema/blocks/workflow.schema.ts`, held to the
 * server's values by `test/stepInputLimits.test.ts`.
 *
 * Dependency-free on purpose: the mock host uses it, and nothing here may raise
 * this package's `@civitai/app-sdk` peer floor
 * (`tests/guards/blocks-react-peer-floor.test.mjs`).
 *
 * Why the mock needs it: without these rules a block tested against
 * `createMockHost` passes with a multi-megabyte `data:` URI in a step input,
 * and the same body is refused by every real estimate and submit.
 */

/**
 * Max serialized size of one pass-through step `input`. The server's
 * `PASS_THROUGH_INPUT_BYTES_MAX`, and the same number as its summed
 * `WORKFLOW_INPUT_BYTES_MAX` for a `kind: 'workflow'` body.
 *
 * 🔴 MEASURED AS THE SERVER MEASURES IT: `JSON.stringify(input).length`, the
 * UTF-16 length of the serialization, NOT its UTF-8 byte count. The server's
 * error says "byte", but a non-ASCII input is counted in code units, so do not
 * "fix" this to `TextEncoder` — that would refuse bodies the host accepts.
 */
export const PASS_THROUGH_INPUT_BYTES_MAX = 262_144;

/**
 * Shortest string the server treats as raw base64 media (clause (b) of
 * {@link isInlineMediaString}). Shorter base64-looking strings — ids, hashes,
 * seeds, short tokens — are ordinary values.
 */
export const INLINE_MEDIA_RAW_BASE64_MIN_CHARS = 4096;

/** Clause (a): a media `data:` URI, leading whitespace and case ignored. */
const MEDIA_DATA_URI = /^\s*data:(image|video|audio)\//i;
/**
 * Clause (b): nothing but the standard base64 alphabet, then at most two `=`.
 * Whitespace is not in the class, so a string containing any is never a match.
 */
const RAW_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Is this one string inline media, as the server judges it? True when either
 *  (a) it starts with a `data:image/`, `data:video/` or `data:audio/` URI
 *      (after optional leading whitespace, any case); or
 *  (b) it is at least {@link INLINE_MEDIA_RAW_BASE64_MIN_CHARS} characters of
 *      base64 alphabet with optional `=` padding and no whitespace.
 */
export function isInlineMediaString(value: string): boolean {
  if (MEDIA_DATA_URI.test(value)) return true;
  return value.length >= INLINE_MEDIA_RAW_BASE64_MIN_CHARS && RAW_BASE64.test(value);
}

/**
 * The path of the FIRST string inside `value` that {@link isInlineMediaString}
 * flags, or `null` when there is none. Walks objects (own enumerable keys, in
 * order) and arrays recursively, depth first.
 *
 * Paths are relative to `value`: `images[0]`, `source.url`, `frames[2].data`.
 * 🔴 A STRING `value` THAT IS ITSELF MEDIA RETURNS `''` — test the result
 * against `null`, never for truthiness.
 */
export function findInlineMedia(value: unknown): string | null {
  return walk(value, '', new Set());
}

function walk(value: unknown, path: string, seen: Set<object>): string | null {
  if (typeof value === 'string') return isInlineMediaString(value) ? path : null;
  if (value === null || typeof value !== 'object') return null;
  // A structured-clone payload can be cyclic; JSON never is, so the server
  // never sees one. Visit each object once rather than recurse forever.
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = walk(value[i], `${path}[${i}]`, seen);
      if (found !== null) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const found = walk(child, path === '' ? key : `${path}.${key}`, seen);
    if (found !== null) return found;
  }
  return null;
}
