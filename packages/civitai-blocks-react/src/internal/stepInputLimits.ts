/**
 * The host's limits on a PASS-THROUGH step `input`: a `kind: 'step'` body with
 * no `step` id, and every step `input` plus `arguments` of a `kind: 'workflow'`
 * body.
 *
 * 🔴 A VERBATIM PORT. The inline-media half is civitai/civitai
 * `src/server/schema/blocks/inline-media.ts` (constants, regexes, the walk, the
 * path format and the message), and the byte cap is `PASS_THROUGH_INPUT_BYTES_MAX`
 * in `src/server/schema/blocks/workflow.schema.ts`. `test/stepInputLimits.test.ts`
 * pins the values and the message template to the server's literals. Change
 * this file only to follow the server, never to improve on it.
 *
 * Dependency-free on purpose: the mock host uses it, and nothing here may raise
 * this package's `@civitai/app-sdk` peer floor
 * (`tests/guards/blocks-react-peer-floor.test.mjs`).
 */

/**
 * Max serialized size of one pass-through step `input`, and the host's summed
 * `WORKFLOW_INPUT_BYTES_MAX` for a `kind: 'workflow'` body (defined equal).
 *
 * 🔴 MEASURED AS THE SERVER MEASURES IT: `JSON.stringify(input).length`, the
 * UTF-16 length of the serialization, NOT its UTF-8 byte count. The server's
 * error says "byte", but a non-ASCII input is counted in code units, so do not
 * "fix" this to `TextEncoder` — that would refuse bodies the host accepts.
 */
export const PASS_THROUGH_INPUT_BYTES_MAX = 262_144;

export const INLINE_MEDIA_DATA_URI_REGEX = /^\s*data:(image|video|audio)\//i;

/** Base64 alphabet with optional `=` padding. Line-wrapped (MIME) base64 does not match. */
export const INLINE_MEDIA_RAW_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Above any id, hash or token a step input carries. Raw base64 shorter than this
 * is not refused; only the data-URI clause catches a tiny image.
 */
export const INLINE_MEDIA_RAW_BASE64_MIN_CHARS = 4096;

/**
 * Values one body may hold before it is refused outright. A body past it is
 * padding — often properties holding `undefined`, which the byte cap counts as
 * zero bytes — so the search fails CLOSED rather than giving up and accepting.
 */
export const INLINE_MEDIA_MAX_VISITS = 262_144;

export type InlineMediaPath = (string | number)[];

/** Shared by every field of one body, so many fields cannot each spend a full budget. */
export type InlineMediaBudget = { visits: number };

/** Returned when the body holds more than {@link INLINE_MEDIA_MAX_VISITS} values. */
export const INLINE_MEDIA_TOO_MANY_VALUES = 'too-many-values';

export function isInlineMediaString(value: string): boolean {
  if (INLINE_MEDIA_DATA_URI_REGEX.test(value)) return true;
  return value.length >= INLINE_MEDIA_RAW_BASE64_MIN_CHARS && INLINE_MEDIA_RAW_BASE64_REGEX.test(value);
}

type Frame = { value: unknown; key: string | number | null; parent: Frame | null };

function pathOf(frame: Frame): InlineMediaPath {
  const path: InlineMediaPath = [];
  for (let f: Frame | null = frame; f && f.key !== null; f = f.parent) path.push(f.key);
  return path.reverse();
}

/**
 * The JSON path of the first string in `value`, in document order, that carries
 * inline media; `null` if none; {@link INLINE_MEDIA_TOO_MANY_VALUES} once
 * `budget` is spent. Iterative, so nesting depth cannot overflow the stack. The
 * value itself costs one visit, and so does every array element and own key.
 */
export function findInlineMediaPath(
  value: unknown,
  budget: InlineMediaBudget = { visits: 0 },
): InlineMediaPath | null | typeof INLINE_MEDIA_TOO_MANY_VALUES {
  const stack: Frame[] = [{ value, key: null, parent: null }];
  if (++budget.visits > INLINE_MEDIA_MAX_VISITS) return INLINE_MEDIA_TOO_MANY_VALUES;
  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    const node = frame.value;
    if (typeof node === 'string') {
      if (isInlineMediaString(node)) return pathOf(frame);
      continue;
    }
    if (node === null || typeof node !== 'object') continue;
    const children: Frame[] = [];
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (++budget.visits > INLINE_MEDIA_MAX_VISITS) return INLINE_MEDIA_TOO_MANY_VALUES;
        children.push({ value: node[i], key: i, parent: frame });
      }
    } else {
      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (++budget.visits > INLINE_MEDIA_MAX_VISITS) return INLINE_MEDIA_TOO_MANY_VALUES;
        children.push({ value: (node as Record<string, unknown>)[key], key, parent: frame });
      }
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return null;
}

/** `['input', 'images', 0]` → `input.images[0]`. */
export function formatInlineMediaPath(path: InlineMediaPath): string {
  return path.reduce<string>((out, seg) => {
    if (typeof seg === 'number') return `${out}[${seg}]`;
    return out ? `${out}.${seg}` : seg;
  }, '');
}

export function inlineMediaMessage(path: InlineMediaPath): string {
  return (
    `${formatInlineMediaPath(path)} carries inline media (data URI/base64); ` +
    `pass a hosted url instead — for an image, upload it with ` +
    `useImageUpload({ purpose: 'generationSource' }) or pick it with useImagePicker ` +
    `and pass the returned url`
  );
}
