/**
 * A collection's document SCHEMA (`storage.collections.<name>.schema`, civitai/civitai#7491):
 * the JSON Schema subset every document's `data` in the collection must match. The server
 * refuses a create or put that does not match with 400 `schema_violation`, naming the first
 * failing JSON pointer; counters and marks are not document bodies and are not checked.
 *
 * A PORT, for the fake, of the server's `parseCollectionSchema` (civitai
 * `src/shared/constants/block-storage.constants.ts`) and its evaluator
 * (`src/server/services/apps/doc-store-schema.ts`). Messages, pointers, keywords and the
 * order that decides which failure is "first" are the server's: `type`, `const`, `enum`, the
 * string, number and array keywords (`maxLength` before `pattern`), `items` element by
 * element, then `required` in its declared order, then the object's own keys in ascending
 * (UTF-16) order. `pattern` is a JavaScript regular expression with the `u` flag, unanchored,
 * as on the server, so the two agree on every pattern. Not ported: the submit-time ReDoS
 * gate, which needs a server-only analyser.
 */

export const SCHEMA_KEYWORDS = [
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'description',
] as const;
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const;
type SchemaType = (typeof SCHEMA_TYPES)[number];
/** A collection schema as declared: a JSON object whose keywords are the subset above. */
export type CollectionSchema = { readonly [keyword: string]: unknown };

const MAX_DEPTH = 16;
const MAX_BYTES = 16 * 1024;
const PATTERN_MAX_LENGTH = 256;
const PATTERNED_MAX_LENGTH = 1000;
const MAX_PATTERNS = 16;
/** Most `pattern`s across ALL of a manifest's collection schemas (APP_STORAGE_MANIFEST_MAX_PATTERNS). */
export const MANIFEST_MAX_PATTERNS = 32;

const KEYWORDS = new Set<string>(SCHEMA_KEYWORDS);
const TYPES = new Set<string>(SCHEMA_TYPES);
const COUNT_KEYWORDS = ['minLength', 'maxLength', 'minItems', 'maxItems'] as const;
const BOUND_PAIRS = [
  ['minLength', 'maxLength'],
  ['minItems', 'maxItems'],
  ['minimum', 'maximum'],
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isIntegerIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const boundKey = (key: string) => (key.length > 80 ? `${key.slice(0, 80)}…` : key);

/**
 * The server's parse of one collection's `schema`. Returns the schema as declared, or null
 * after pushing one error per problem (the server's text). The size is checked first and the
 * walk stops at the depth limit, as there.
 */
export function parseCollectionSchema(at: string, raw: unknown, errors: string[]): CollectionSchema | null {
  if (!isObject(raw)) {
    errors.push(`${at} must be a schema object`);
    return null;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
  if (bytes > MAX_BYTES) {
    errors.push(`${at} is ${bytes} bytes of JSON — a collection schema may be at most ${MAX_BYTES} bytes`);
    return null;
  }
  const before = errors.length;
  const state = { patterns: 0 };
  parseNode(at, raw, 1, errors, state);
  if (state.patterns > MAX_PATTERNS) {
    errors.push(`${at} declares ${state.patterns} patterns — a collection schema may declare at most ${MAX_PATTERNS}`);
  }
  return errors.length > before ? null : raw;
}

function parseNode(at: string, node: unknown, depth: number, errors: string[], state: { patterns: number }): void {
  if (depth > MAX_DEPTH) {
    errors.push(`${at} is nested too deeply — a collection schema may nest at most ${MAX_DEPTH} schemas`);
    return;
  }
  if (!isObject(node)) {
    errors.push(`${at} must be a schema object`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key)) {
      errors.push(
        `${at} uses the schema keyword ${JSON.stringify(boundKey(key))}, which is not supported — the supported keywords are ${SCHEMA_KEYWORDS.join(', ')}`,
      );
    }
  }
  const child = (path: string, sub: unknown) => parseNode(path, sub, depth + 1, errors, state);

  if (node.type !== undefined) {
    const list: unknown[] = Array.isArray(node.type) ? node.type : [node.type];
    const valid =
      list.length > 0 && list.every((t) => typeof t === 'string' && TYPES.has(t)) && new Set(list).size === list.length;
    if (!valid) {
      errors.push(`${at}.type must be one of ${SCHEMA_TYPES.join(', ')}, or a non-empty array of them without repeats`);
    }
  }
  if (node.properties !== undefined) {
    if (!isObject(node.properties)) {
      errors.push(`${at}.properties must be an object mapping a property name to its schema`);
    } else {
      for (const [name, sub] of Object.entries(node.properties)) child(`${at}.properties.${boundKey(name)}`, sub);
    }
  }
  if (node.required !== undefined) {
    const list = node.required;
    if (!Array.isArray(list) || !list.every((k) => typeof k === 'string') || new Set(list).size !== list.length) {
      errors.push(`${at}.required must be an array of distinct property names`);
    }
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    child(`${at}.additionalProperties`, node.additionalProperties);
  }
  if (node.items !== undefined) child(`${at}.items`, node.items);
  if (node.enum !== undefined && !(Array.isArray(node.enum) && node.enum.length > 0)) {
    errors.push(`${at}.enum must be a non-empty array of values`);
  }
  for (const keyword of COUNT_KEYWORDS) {
    const value = node[keyword];
    if (value !== undefined && !isIntegerIn(value, 0, Number.MAX_SAFE_INTEGER)) {
      errors.push(`${at}.${keyword} must be a whole number of 0 or more`);
    }
  }
  for (const keyword of ['minimum', 'maximum'] as const) {
    const value = node[keyword];
    if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value))) {
      errors.push(`${at}.${keyword} must be a number`);
    }
  }
  for (const [low, high] of BOUND_PAIRS) {
    const a = node[low];
    const b = node[high];
    if (typeof a === 'number' && typeof b === 'number' && a > b) {
      errors.push(`${at}.${low} (${a}) is greater than ${high} (${b}), so nothing could match`);
    }
  }
  if (node.pattern !== undefined) {
    state.patterns++;
    const pattern = node.pattern;
    if (typeof pattern !== 'string' || Array.from(pattern).length > PATTERN_MAX_LENGTH) {
      errors.push(`${at}.pattern must be a string of at most ${PATTERN_MAX_LENGTH} characters`);
    } else {
      try {
        new RegExp(pattern, 'u');
      } catch {
        errors.push(`${at}.pattern is not a valid regular expression (JavaScript syntax with the "u" flag)`);
      }
    }
    if (
      !isIntegerIn(node.maxLength, 0, PATTERNED_MAX_LENGTH) &&
      // A malformed maxLength already has its own error.
      (node.maxLength === undefined || isIntegerIn(node.maxLength, 0, Number.MAX_SAFE_INTEGER))
    ) {
      errors.push(
        `${at}.pattern needs a maxLength of at most ${PATTERNED_MAX_LENGTH} on the same schema — a pattern only ever runs against a bounded string`,
      );
    }
  }
  if (node.description !== undefined && typeof node.description !== 'string') {
    errors.push(`${at}.description must be a string`);
  }
}

/**
 * How many `pattern` SITES a parsed schema declares (a source repeated is counted each time),
 * as the server's `schemaPatternSites` walks it: for the manifest-wide cap.
 */
export function countSchemaPatterns(schema: CollectionSchema): number {
  let n = 0;
  const walk = (node: unknown) => {
    if (!isObject(node)) return;
    if (typeof node.pattern === 'string') n++;
    if (isObject(node.properties)) for (const sub of Object.values(node.properties)) walk(sub);
    walk(node.items);
    walk(node.additionalProperties);
  };
  walk(schema);
  return n;
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/** The first place `data` fails its schema. */
export interface SchemaFailure {
  pointer: string;
  keyword: string;
  reason: string;
}
type Check = (value: unknown, pointer: string) => SchemaFailure | null;

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function hasType(t: SchemaType, v: unknown): boolean {
  switch (t) {
    case 'object':
      return isObject(v);
    case 'array':
      return Array.isArray(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'null':
      return v === null;
    default:
      return typeof v === t;
  }
}

/** Equality of two JSON values (own keys only, any key order). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
/** Length in code points, as JSON Schema counts it (a UTF-16 surrogate pair is one). */
const codePoints = (s: string) => Array.from(s).length;
const byUtf16 = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Compiles a schema `parseCollectionSchema` accepted. */
export function compileCollectionSchema(schema: CollectionSchema): (data: unknown) => SchemaFailure | null {
  const check = compile(schema);
  return (data) => check(data, '');
}

function compile(schema: CollectionSchema): Check {
  const checks: Check[] = [];
  const fail = (pointer: string, keyword: string, reason: string): SchemaFailure => ({ pointer, keyword, reason });

  if (schema.type !== undefined) {
    const types = (Array.isArray(schema.type) ? schema.type : [schema.type]) as SchemaType[];
    const expected = types.join(' or ');
    checks.push((v, p) => (types.some((t) => hasType(t, v)) ? null : fail(p, 'type', `expected ${expected}, got ${typeName(v)}`)));
  }
  if (Object.hasOwn(schema, 'const')) {
    const value = schema.const;
    checks.push((v, p) => (jsonEqual(v, value) ? null : fail(p, 'const', 'must equal the value the schema fixes (const)')));
  }
  if (Array.isArray(schema.enum)) {
    const values = schema.enum as unknown[];
    checks.push((v, p) => (values.some((x) => jsonEqual(v, x)) ? null : fail(p, 'enum', "must be one of the schema's enum values")));
  }

  const { minLength, maxLength, pattern, minimum, maximum, minItems, maxItems } = schema;
  if (typeof minLength === 'number') {
    checks.push((v, p) =>
      typeof v === 'string' && codePoints(v) < minLength ? fail(p, 'minLength', `must be at least ${minLength} characters`) : null,
    );
  }
  if (typeof maxLength === 'number') {
    checks.push((v, p) =>
      typeof v === 'string' && codePoints(v) > maxLength ? fail(p, 'maxLength', `must be at most ${maxLength} characters`) : null,
    );
  }
  if (typeof pattern === 'string') {
    // No `g` or `y` flag, so `test` keeps no state between calls.
    const re = new RegExp(pattern, 'u');
    checks.push((v, p) =>
      typeof v === 'string' && !re.test(v) ? fail(p, 'pattern', `must match the pattern ${JSON.stringify(pattern)}`) : null,
    );
  }
  if (typeof minimum === 'number') {
    checks.push((v, p) => (typeof v === 'number' && v < minimum ? fail(p, 'minimum', `must be at least ${minimum}`) : null));
  }
  if (typeof maximum === 'number') {
    checks.push((v, p) => (typeof v === 'number' && v > maximum ? fail(p, 'maximum', `must be at most ${maximum}`) : null));
  }
  if (typeof minItems === 'number') {
    checks.push((v, p) =>
      Array.isArray(v) && v.length < minItems ? fail(p, 'minItems', `must have at least ${minItems} items`) : null,
    );
  }
  if (typeof maxItems === 'number') {
    checks.push((v, p) =>
      Array.isArray(v) && v.length > maxItems ? fail(p, 'maxItems', `must have at most ${maxItems} items`) : null,
    );
  }
  if (isObject(schema.items)) {
    const item = compile(schema.items);
    checks.push((v, p) => {
      if (!Array.isArray(v)) return null;
      for (let i = 0; i < v.length; i++) {
        const f = item(v[i], `${p}/${i}`);
        if (f) return f;
      }
      return null;
    });
  }

  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  // A Map, not the declared object: a property named `constructor` must not resolve to
  // Object.prototype's.
  const properties = new Map<string, Check>(
    isObject(schema.properties)
      ? Object.entries(schema.properties).map(([k, s]) => [k, compile(s as CollectionSchema)])
      : [],
  );
  const additional = schema.additionalProperties;
  const additionalCheck = isObject(additional) ? compile(additional) : null;
  if (required.length > 0 || properties.size > 0 || additional !== undefined) {
    checks.push((v, p) => {
      if (!isObject(v)) return null;
      for (const k of required) {
        if (!Object.hasOwn(v, k)) return fail(`${p}/${escapePointer(k)}`, 'required', 'is required');
      }
      for (const k of Object.keys(v).sort(byUtf16)) {
        const at = `${p}/${escapePointer(k)}`;
        const declared = properties.get(k);
        let f: SchemaFailure | null = null;
        if (declared) f = declared(v[k], at);
        else if (additional === false) f = fail(at, 'additionalProperties', 'is not a property the schema allows');
        else if (additionalCheck) f = additionalCheck(v[k], at);
        if (f) return f;
      }
      return null;
    });
  }

  return (value, pointer) => {
    for (const check of checks) {
      const f = check(value, pointer);
      if (f) return f;
    }
    return null;
  };
}

/** Longest pointer quoted in a message; `details.pointer` always carries the whole one. */
const MESSAGE_POINTER_MAX = 200;

/** The server's refusal text for a failure in collection `name`. */
export function schemaViolationMessage(name: string, { pointer, reason }: SchemaFailure): string {
  const shown = pointer.length > MESSAGE_POINTER_MAX ? `${pointer.slice(0, MESSAGE_POINTER_MAX)}…` : pointer;
  const where = pointer === '' ? '"" (the document root)' : JSON.stringify(shown);
  return `document does not match the schema of collection ${name} at ${where}: ${reason}`;
}
