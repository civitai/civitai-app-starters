/**
 * Which validation error to REPORT when a `oneOf` / `anyOf` fails.
 *
 * INTERNAL to `./defineBlock` — not re-exported from `./index`, and typed
 * structurally (no Ajv import) so it can be exercised against small synthetic
 * schemas in `test/manifest/discriminated-branch.test.ts`.
 */

/** The fields of an Ajv `ErrorObject` this reads. `schema` and `data` need Ajv's `verbose: true`. */
export interface ValidationErrorLike {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  schema?: unknown;
  data?: unknown;
}

/** The discriminator that selected the member an error is reported from. */
export interface Discriminator {
  key: string;
  value: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ value }` when `member.properties[key]` pins a primitive `const`, else `null`. */
function constOf(member: unknown, key: string): { value: unknown } | null {
  const prop = isRecord(member) && isRecord(member.properties) ? member.properties[key] : undefined;
  if (!isRecord(prop) || !('const' in prop)) return null;
  return typeof prop.const === 'object' && prop.const !== null ? null : { value: prop.const };
}

/**
 * The property every member of a `oneOf` / `anyOf` pins to its own `const` —
 * `type` in `[{ properties: { type: { const: 'enum' } } }, { … 'number' }, …]` —
 * or `undefined` when the members do not discriminate that way. Read from the
 * schema, so nothing here names a manifest field.
 */
function discriminatorKey(members: unknown[]): string | undefined {
  const first = members[0];
  if (!isRecord(first) || !isRecord(first.properties)) return undefined;
  return Object.keys(first.properties).find((key) =>
    members.every((member) => constOf(member, key) !== null),
  );
}

/**
 * Picks the error to REPORT. Ajv (with `allErrors`) validates every member of
 * a failed `oneOf` / `anyOf` and lists all their errors in member order, so
 * the plain first error is the FIRST MEMBER's complaint whichever member the
 * author was writing: a `{ type: 'number', min: 0 }` property declaration used
 * to be reported as "`values` is required", the `enum` member's rule.
 *
 * Where the members discriminate on a `const` (see {@link discriminatorKey})
 * and the instance's value for that key equals exactly one member's, that
 * member is the one the author meant: errors from the OTHER members, on that
 * instance, are skipped, and the first error left is returned. (The summary
 * `oneOf` / `anyOf` error needs no handling: Ajv lists it after the members'
 * own errors.) `discriminator` is set when the returned error is on the
 * discriminated object itself, so the message can say which member it is from.
 *
 * Any other failed composition — no shared `const` property, or a value no
 * member names, or more than one member naming it — is left exactly as it
 * was: the first error wins.
 *
 * 🔴 SELECTION ONLY. It is given the errors of a manifest Ajv has already
 * rejected and returns one of them (the plain first if it would otherwise skip
 * everything; `undefined` only for an empty list), so it cannot turn a
 * rejection into an acceptance or the reverse.
 *
 * Members reached through `$ref` report a `schemaPath` relative to the
 * referenced schema, so their errors are not recognised as a member's and are
 * never skipped — that site degrades to "first error not from a recognised
 * other member". The canonical uses no `$ref` today.
 */
export function preferDiscriminatedBranch<E extends ValidationErrorLike>(
  errors: E[],
): { error: E; discriminator?: Discriminator } | undefined {
  // One entry per member of each discriminated composition that failed: where
  // its errors live (`prefix`), on which instance, and — for the member the
  // instance's discriminator names — the discriminator (`chosen`).
  const scopes: Array<{ prefix: string; instancePath: string; chosen?: Discriminator }> = [];
  for (const error of errors) {
    if (error.keyword !== 'oneOf' && error.keyword !== 'anyOf') continue;
    const members = error.schema;
    if (!Array.isArray(members) || !isRecord(error.data)) continue;
    const key = discriminatorKey(members);
    if (key === undefined) continue;
    const value = error.data[key];
    const matching = members.flatMap((member, index) =>
      constOf(member, key)?.value === value ? [index] : [],
    );
    if (matching.length !== 1) continue;
    members.forEach((_member, index) => {
      scopes.push({
        prefix: `${error.schemaPath}/${index}/`,
        instancePath: error.instancePath,
        ...(index === matching[0] ? { chosen: { key, value } } : {}),
      });
    });
  }

  for (const error of errors) {
    // Compositions nest, so an error can sit inside several members at once.
    const within = scopes.filter(
      (s) =>
        error.schemaPath.startsWith(s.prefix) &&
        (error.instancePath === s.instancePath ||
          error.instancePath.startsWith(`${s.instancePath}/`)),
    );
    // Inside a member, at any level, that its instance's discriminator does not name.
    if (within.some((s) => !s.chosen)) continue;
    // The member is named in the message only for an error ON the discriminated
    // object itself (the innermost one), not for one on something nested inside it.
    const innermost = within.reduce<(typeof within)[number] | undefined>(
      (a, b) => (a && a.prefix.length >= b.prefix.length ? a : b),
      undefined,
    );
    return innermost?.chosen && error.instancePath === innermost.instancePath
      ? { error, discriminator: innermost.chosen }
      : { error };
  }
  return errors[0] ? { error: errors[0] } : undefined;
}
