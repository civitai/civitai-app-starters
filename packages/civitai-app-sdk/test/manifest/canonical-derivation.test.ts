/**
 * `defineBlock` is DERIVED from the canonical schema. This suite is the part of
 * that claim a reader can check.
 *
 * WHAT EACH BLOCK BELOW IS WORTH, stated so nobody reads more into it:
 *   - HARNESS CONTROLS. Until both have been watched to work, every result here
 *     is a fact about the harness. The negative control shows `defineBlock` CAN
 *     say no; the positive control shows the Ajv oracle CAN say yes. A suite
 *     whose oracle rejects everything would pass the divergence ledger vacuously.
 *   - THE #330 CLOSING CONDITION. Every shipped `block.manifest.json` is
 *     accepted. This is the assertion the issue names; it fails on all seven at
 *     `9a060f3`.
 *   - NOT-ABOVE-THE-CANONICAL. The regression body. Each fixture is one rule the
 *     PREVIOUS implementation hand-wrote above the canonical; the canonical
 *     accepts it, so `defineBlock` must. These are the cases that go red on the
 *     previous commit.
 *   - DERIVED-NOT-MIRRORED. Rules nobody wrote down here at all, enforced only
 *     because Ajv reads them out of the vendored schema. If the implementation
 *     ever stops compiling the schema, these die.
 *   - INVARIANT GUARDS, labelled. Green before the change as well as after — NOT
 *     regression coverage, and not counted as any.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { defineBlock, loadCanonicalSchema } from '../../src/manifest/defineBlock.js';
import { BlockManifestError } from '../../src/blocks/manifestError.js';
import { BLOCK_SCOPES, BLOCK_TAGLINE_MAX_LENGTH } from '../../src/blocks/scopes.js';
import type { BlockManifest } from '../../src/blocks/types.js';
import { canonicalAccepts, shippedManifests, valid, without } from './fixtures.js';

const accept = (manifest: Record<string, unknown>) =>
  defineBlock({ manifest: manifest as unknown as BlockManifest });

function rejection(manifest: Record<string, unknown>): BlockManifestError {
  try {
    accept(manifest);
  } catch (err) {
    if (err instanceof BlockManifestError) return err;
    throw err;
  }
  throw new Error('expected defineBlock to throw, it did not');
}

describe('harness controls', () => {
  it('NEGATIVE CONTROL: defineBlock can say no (a canonical rule, not a divergence)', () => {
    // `blockId` pattern lives ONLY in the schema — nothing below hand-writes it.
    const err = rejection(valid({ blockId: 'X' }));
    expect(err.field).toBe('blockId');
  });

  it('POSITIVE CONTROL: the Ajv oracle can say yes (a zero here makes the ledger vacuous)', () => {
    expect(canonicalAccepts(valid())).toBe(true);
  });

  it('POSITIVE CONTROL: the Ajv oracle can say no', () => {
    expect(canonicalAccepts(valid({ contentRating: 'nc17' }))).not.toBe(true);
  });
});

describe('#330 closing condition: every shipped block.manifest.json is accepted', () => {
  const shipped = shippedManifests();

  it('found the shipped manifests at all (INVARIANT GUARD — green before this change too)', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(7);
  });

  it.each(shipped.map((m) => [m.label, m] as const))('%s', (_label, { manifest }) => {
    expect(() => defineBlock({ manifest })).not.toThrow();
  });

  it.each(shipped.map((m) => [m.label, m] as const))(
    '%s is accepted by the canonical schema itself',
    (_label, { manifest }) => {
      expect(canonicalAccepts(manifest)).toBe(true);
    },
  );
});

/**
 * Each case: the canonical ACCEPTS it, therefore `defineBlock` must. Every one
 * of them is a rule the previous implementation hand-wrote above the canonical,
 * and every one is red at `9a060f3`.
 */
describe('NOT ABOVE THE CANONICAL: rules the previous implementation invented', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    // -- deleted in this change -------------------------------------------
    [
      '$schema pointing at a vendored copy (canonical: "ignored by the platform validator")',
      valid({ $schema: './node_modules/@civitai/app-sdk/schemas/app-block/v1.json' }),
    ],
    ['$schema pointing at a v2 preview', valid({ $schema: 'https://civitai.com/schemas/app-block/v2.json' })],
    ['appId absent', without(['appId'])],
    ['appId as a number (not a canonical property at all)', valid({ appId: 137 })],
    ['assets present (not a canonical property; the server ignores it)', valid({ assets: [{ url: 'x' }] })],
    ['targets[].priority non-integer (not a canonical property)', valid({ targets: [{ slotId: 's', priority: 1.5 }] })],
    // -- already relaxed by the previous commit; pinned so they stay relaxed
    ["type: 'embed' is still refused, but type may be omitted", without(['type'])],
    ['targets omitted (canonical: "Optional for page-only apps")', without(['targets'])],
    ['iframe omitted (canonical declares no required sub-fields on it)', without(['iframe'])],
    ['iframe with only sandbox', valid({ iframe: { sandbox: 'allow-scripts' } })],
    ['iframe.maxHeight null', valid({ iframe: { minHeight: 137, maxHeight: null } })],
    ['minApiVersion omitted', without(['minApiVersion'])],
    ['a 137-character name (the canonical caps nothing)', valid({ name: 'x'.repeat(137) })],
    ['an empty scopes array (the canonical sets no minItems)', valid({ scopes: [] })],
    // -- analytics: a valid declaration is accepted (control for the rejections below)
    [
      'analytics with all three property types',
      valid({
        analytics: {
          events: {
            render_started: { description: 'The user pressed Generate.' },
            render_finished: {
              properties: {
                style: { type: 'enum', values: ['anime', 'photo'] },
                seconds: { type: 'number' },
                upscaled: { type: 'boolean' },
              },
            },
          },
        },
      }),
    ],
    ['analytics empty, and with an empty events map', valid({ analytics: { events: {} } })],
  ];

  it.each(cases)('%s', (_label, manifest) => {
    // If this line fails, the fixture is wrong, not the implementation.
    expect(canonicalAccepts(manifest), 'fixture must be canonical-VALID').toBe(true);
    expect(() => accept(manifest)).not.toThrow();
  });
});

/**
 * Rules that exist here ONLY because Ajv reads them out of the vendored schema.
 * Nothing in `src/manifest/defineBlock.ts` names any of these fields. Delete the
 * Ajv compile and every case below goes green-when-it-should-be-red.
 */
describe('DERIVED, NOT MIRRORED: canonical rules no line of this package writes down', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['blockId pattern', valid({ blockId: 'Not-A-DNS-Label' }), 'blockId'],
    ['blockId minLength', valid({ blockId: 'ab' }), 'blockId'],
    ['version pattern', valid({ version: 'v1' }), 'version'],
    ['contentRating enum', valid({ contentRating: 'nc17' }), 'contentRating'],
    ["type enum is ['block'] — 'embed' is NOT a member", valid({ type: 'embed' }), 'type'],
    ['scopes enum', valid({ scopes: ['not:a:scope'] }), 'scopes[0]'],
    ['targets maxItems', valid({ targets: Array.from({ length: 17 }, () => ({ slotId: 's' })) }), 'targets'],
    ['targets[].slotId required', valid({ targets: [{ priority: 1 }] }), 'targets[0].slotId'],
    ['iframe.minHeight floor', valid({ iframe: { minHeight: 39 } }), 'iframe.minHeight'],
    ['iframe.maxHeight ceiling', valid({ iframe: { maxHeight: 4137 } }), 'iframe.maxHeight'],
    ['iframe additionalProperties:false', valid({ iframe: { minHeight: 137, bogus: 1 } }), 'iframe.bogus'],
    ['minApiVersion pattern', valid({ minApiVersion: '1.0-beta' }), 'minApiVersion'],
    ['renderMode enum', valid({ renderMode: 'canvas' }), 'renderMode'],
    // RED before this re-vendor: without the canonical's `auth` enum the
    // top-level object is open (it declares no `additionalProperties`), so Ajv
    // accepts ANY `auth` value and no rejection happens. This is the regression
    // case for the schema re-vendor itself.
    ['auth enum', valid({ auth: 'api-key' }), 'auth'],
    ['bootSkeleton type', valid({ bootSkeleton: 'yes' }), 'bootSkeleton'],
    ['category enum', valid({ category: 'miscellaneous' }), 'category'],
    ['tagline maxLength (RAW, per the canonical)', valid({ tagline: 'x'.repeat(141) }), 'tagline'],
    ['repository pattern', valid({ repository: 'git@github.com:owner/repo.git' }), 'repository'],
    ['buildCommand allowlist', valid({ buildCommand: 'rm -rf /', outputDir: 'dist' }), 'buildCommand'],
    ['allOf: outputDir required with buildCommand', valid({ buildCommand: 'vite build' }), 'outputDir'],
    ['outputDir traversal', valid({ buildCommand: 'vite build', outputDir: '../../etc' }), 'outputDir'],
    ['publicSettingsKeys maxItems', valid({ publicSettingsKeys: Array.from({ length: 33 }, (_, i) => `k${i}`) }), 'publicSettingsKeys'],
    ['assetBundleUrl pattern', valid({ assetBundleUrl: 'http://cdn.example.com/b.zip' }), 'assetBundleUrl'],
    ['page.path required', valid({ page: { title: 'T' } }), 'page.path'],
    ['page additionalProperties:false', valid({ page: { path: '/x', title: 'T', bogus: 1 } }), 'page.bogus'],
    // -- analytics (custom events): every rule below is the canonical's ------
    [
      "analytics: no free-text 'string' property type",
      valid({ analytics: { events: { searched: { properties: { query: { type: 'string' } } } } } }),
      'analytics.events.searched.properties.query.type',
    ],
    [
      'analytics: an event name must be lowercase snake_case',
      valid({ analytics: { events: { RenderStarted: {} } } }),
      'analytics.events.RenderStarted',
    ],
    [
      'analytics: an enum must declare values',
      valid({ analytics: { events: { picked: { properties: { style: { type: 'enum' } } } } } }),
      'analytics.events.picked.properties.style.values',
    ],
    [
      'analytics: an enum must declare at least one value',
      valid({ analytics: { events: { picked: { properties: { style: { type: 'enum', values: [] } } } } } }),
      'analytics.events.picked.properties.style.values',
    ],
    [
      'analytics: unknown key on analytics',
      valid({ analytics: { events: {}, sampleRate: 0.5 } }),
      'analytics.sampleRate',
    ],
    [
      'analytics: unknown key on an event',
      valid({ analytics: { events: { clicked: { category: 'ui' } } } }),
      'analytics.events.clicked.category',
    ],
    [
      'analytics: unknown key on a property declaration',
      valid({
        analytics: {
          events: { clicked: { properties: { via: { type: 'enum', values: ['key'], label: 'x' } } } },
        },
      }),
      'analytics.events.clicked.properties.via.label',
    ],
    // ⚠ REJECTED, BUT THE MESSAGE POINTS AT THE WRONG THING. A property
    // declaration is a `oneOf` of three closed shapes, and for a `number` or
    // `boolean` carrying an extra key the reported error is the FIRST branch's
    // ("`values` is required"), not "`label` is not a known property". The
    // verdict is right and is what this pins; the wording is a known wart of
    // reporting a failed `oneOf`, not a rule of the canonical.
    [
      'analytics: unknown key on a boolean property declaration (verdict only — see note)',
      valid({ analytics: { events: { clicked: { properties: { on: { type: 'boolean', label: 'x' } } } } } }),
      'analytics.events.clicked.properties.on.values',
    ],
    [
      'analytics: values on a number property',
      valid({ analytics: { events: { timed: { properties: { seconds: { type: 'number', values: ['1'] } } } } } }),
      'analytics.events.timed.properties.seconds.type',
    ],
    ['scopeJustifications value maxLength', valid({ scopeJustifications: { 'models:read:self': 'x'.repeat(501) } }), 'scopeJustifications.models:read:self'],
  ];

  it.each(cases)('%s', (_label, manifest, field) => {
    expect(canonicalAccepts(manifest), 'fixture must be canonical-INVALID').not.toBe(true);
    expect(rejection(manifest).field).toBe(field);
  });

  it('the PascalCase scope hint fires on the scope case, not a neighbour', () => {
    const err = rejection(valid({ scopes: ['ModelsReadSelf'] }));
    expect(err.field).toBe('scopes[0]');
    expect(err.message).toContain('colon-separated lowercase');
  });
});

/**
 * The body of `export interface <name>` in a TypeScript source, from the
 * declaration line to the first line that is exactly `}`.
 *
 * Deliberately crude — it reads SOURCE TEXT, so it cannot resolve `extends` or
 * a mapped type, and a shape that ever needs either should move to a real
 * compiler-API walk rather than being regex-widened.
 *
 * 🔴 IT RETURNS `''` FOR AN INTERFACE IT CANNOT FIND, and an empty body makes
 * every property check below "match nothing" and report clean — a guard that
 * retires itself the first time an interface is renamed or reformatted. Every
 * call site below therefore asserts the returned body is non-empty before
 * using it (the two `BlockManifestV1` reads and the per-shape read in the nested
 * test). Pair any new caller with the same assertion.
 */
function interfaceBody(src: string, name: string): string {
  const start = src.indexOf(`export interface ${name} {`);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}');
  return end < 0 ? '' : rest.slice(0, end);
}

/**
 * Nested manifest shapes typed on `BlockManifestV1` AHEAD of the vendored
 * schema bytes, and the deep-path twin of the same list. BOTH ARE EMPTY, and
 * that is the normal state.
 *
 * They stay because the two shape ledgers below are EXACT. This repo's
 * practice is to type a new manifest field before the published schema carries
 * it, so that the scheduled re-vendor lands on an already-typed interface — and
 * with an exact ledger a new NESTED shape would turn that re-vendor red however
 * well it was typed. A shape listed here is expected by its ledger only once
 * the vendored schema carries it, which keeps the suite green on both sides of
 * the re-vendor. When the bytes land, move the entry into `LEDGER` /
 * `DEEP_LEDGER` and empty this again.
 */
const TYPED_AHEAD: string[] = [];
const DEEP_TYPED_AHEAD: string[] = [];

/**
 * Every object shape in a JSON schema, keyed by a path from the manifest root,
 * with the property names the schema declares on it.
 *
 * Path grammar: `a.b` for a named property, `a.*` for a value reached through
 * `patternProperties` or an `additionalProperties` schema (a map), `a[]` for an
 * array's `items`. A node's own key set is the UNION of its inline
 * `properties` and those of every `allOf` / `oneOf` / `anyOf` branch, because
 * any one of them is a key a manifest can legally carry there. Branches are
 * descended into as well, so a nested shape declared only inside a branch is
 * still found. `$ref` is NOT resolved — the canonical uses none today, and the
 * shape ledger below would go red (SHRINK) if one replaced an inline shape.
 */
function schemaShapes(root: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const join = (path: string, seg: string) => (path === '' ? seg : `${path}.${seg}`);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const branches = (n: Record<string, unknown>): Record<string, unknown>[] =>
    (['allOf', 'oneOf', 'anyOf'] as const).flatMap((k) =>
      Array.isArray(n[k]) ? (n[k] as unknown[]).filter(isObj) : [],
    );
  const keysOf = (n: Record<string, unknown>): string[] => [
    ...(isObj(n.properties) ? Object.keys(n.properties) : []),
    ...branches(n).flatMap(keysOf),
  ];
  const walk = (n: unknown, path: string): void => {
    if (!isObj(n)) return;
    const keys = keysOf(n);
    if (keys.length > 0) {
      const set = out.get(path) ?? new Set<string>();
      keys.forEach((k) => set.add(k));
      out.set(path, set);
    }
    for (const node of [n, ...branches(n)]) {
      if (isObj(node.properties)) {
        for (const [k, v] of Object.entries(node.properties)) walk(v, join(path, k));
      }
      if (isObj(node.patternProperties)) {
        for (const v of Object.values(node.patternProperties)) walk(v, join(path, '*'));
      }
      if (isObj(node.additionalProperties)) walk(node.additionalProperties, join(path, '*'));
      if (isObj(node.items)) walk(node.items, `${path}[]`);
    }
  };
  walk(root, '');
  return out;
}

/**
 * The property names TypeScript gives the type reached by `path` from
 * `BlockManifestV1`, via the COMPILER (not a source regex), so a type alias, a
 * union or a `Record<string, X>` resolves the same way an inline literal
 * passed to `defineBlock` is checked. A union contributes every member's keys
 * (a discriminated union admits each member's keys on that member). Returns
 * `null` when the path does not resolve, which the caller reports by name.
 */
let compiled: ts.Program | undefined;
function typeKeysAt(path: string): Set<string> | null {
  const file = fileURLToPath(new URL('../../src/blocks/types.ts', import.meta.url));
  const program = (compiled ??= ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  }));
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  if (!sf) return null;
  const decl = sf.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === 'BlockManifestV1',
  );
  if (!decl) return null;
  let t: ts.Type | undefined = checker.getTypeAtLocation(decl.name);
  for (const seg of path.split(/\.|(?=\[\])/)) {
    if (!t) return null;
    t = checker.getNonNullableType(t);
    if (seg === '*') {
      t = checker.getIndexInfoOfType(t, ts.IndexKind.String)?.type;
    } else if (seg === '[]') {
      t = checker.isArrayType(t) ? checker.getTypeArguments(t as ts.TypeReference)[0] : undefined;
    } else {
      const sym = checker.getPropertyOfType(t, seg);
      t = sym ? checker.getTypeOfSymbolAtLocation(sym, decl) : undefined;
    }
  }
  if (!t) return null;
  t = checker.getNonNullableType(t);
  const members = t.isUnion() ? t.types : [t];
  return new Set(members.flatMap((m) => checker.getPropertiesOfType(m).map((p) => p.name)));
}

describe('lockstep with the vendored schema (INVARIANT GUARDS — green before this change too)', () => {
  const schema = loadCanonicalSchema() as {
    required: string[];
    properties: Record<string, { maxLength?: number; items?: { enum?: string[] } }>;
  };

  it('BLOCK_TAGLINE_MAX_LENGTH equals the canonical tagline bound', () => {
    expect(BLOCK_TAGLINE_MAX_LENGTH).toBe(schema.properties.tagline?.maxLength);
  });

  it('the canonical requires exactly five fields', () => {
    expect([...schema.required].sort()).toEqual(
      ['blockId', 'contentRating', 'name', 'scopes', 'version'].sort(),
    );
  });

  /**
   * 🔴 RE-INSTATES A GUARD A REFACTOR DROPPED, rather than adding a new one.
   * `test/blocks/schema-parity.test.ts` carried this claim — *"DRIFT GUARD: the
   * schema's scope enum is EXACTLY the SDK's BLOCK_SCOPES set. If either side
   * gains/loses a scope without the other, this fails"* — until `d41293d`
   * (#352) deleted that file, rewriting schema-parity as an Ajv-backed
   * DIFFERENTIAL which judges FIXTURES rather than constant sets. This
   * assertion went as collateral. (`BLOCK_CATEGORIES` ↔ the schema's `category`
   * enum died in the same move and is NOT restored here.)
   *
   * ⚠ NOT byte-for-byte the same assertion, and the difference is the one this
   * block argues about: the historic form compared two `Set`s, which
   * structurally cannot see a duplicate. The sorted-array form below can, which
   * is why the duplicate case below it is a real addition rather than something
   * that was previously guarded and lost.
   *
   * It is not redundant with the `describe('BLOCK_SCOPES')` in
   * `test/blocks/scopes.test.ts`: that one compares `BLOCK_SCOPES` against
   * `CANONICAL_BLOCK_SCOPES`, a literal transcription kept in that same file,
   * so both halves move in a single edit. This crosses to the VENDORED SCHEMA —
   * a separately re-vendored artifact, and the thing that actually validates a
   * manifest. Measured: removing a non-shipped scope from the schema alone
   * fails ONLY this assertion, with the other suite green.
   *
   * Why it has teeth beyond documentation: `BLOCK_SCOPES` is a live enforcement
   * surface in a second package — `civitai-blocks-react`'s
   * `src/internal/consent.ts` builds `isKnownBlockScope` from
   * `Object.values(BLOCK_SCOPES)` — while the server and `defineBlock` gate on
   * the schema enum. Divergence means a scope the server grants that
   * blocks-react rejects as unknown.
   */
  it('every canonical top-level property is TYPED on BlockManifestV1 — fails when the schema grows', () => {
    // 🔴 THE GAP THIS CLOSES, MEASURED: the canonical schema carried `goods` while
    // `BlockManifestV1` did not, so `defineBlock`'s own documented inline-literal
    // form rejected a goods declaration with TS2353 while Ajv accepted the same
    // manifest loaded from a JSON file. Nothing could see it — the check below
    // this one pins the scopes ENUM against BLOCK_SCOPES, and nothing pinned the
    // schema's PROPERTY SET against the interface's KEYS.
    //
    // Read from the TypeScript SOURCE rather than a hand-written list, so the
    // ledger cannot drift from the type it claims to describe. (Deliberately
    // the source and not `dist/blocks/types.d.ts`: the emitted declarations are
    // a build artifact this suite must not require, and `defineBlock`'s
    // inline-literal form is checked against the source anyway.)
    const src = readFileSync(
      new URL('../../src/blocks/types.ts', import.meta.url),
      'utf8',
    );
    const body = interfaceBody(src, 'BlockManifestV1');
    // Positive control on the parse, the same one the nested test applies to
    // each shape it resolves: an empty body makes EVERY property check below
    // "match nothing" and report clean, so a renamed or reformatted interface
    // would silently retire this guard rather than fail it.
    expect(body, 'interface BlockManifestV1 not found in types.ts').not.toBe('');
    // `$schema` is a JSON-Schema META key, not a manifest field — a manifest may
    // carry it to name the schema it validates against, and the TYPE should not.
    // Named as the one exception rather than widening the filter until it passes:
    // an unexplained allowlist is how this class of guard goes quiet.
    const META_ONLY = ['$schema'];
    const schemaProps = Object.keys(schema.properties ?? {}).filter(
      (k) => !META_ONLY.includes(k),
    );
    expect(schemaProps.length).toBeGreaterThan(5); // positive control on the read
    const untyped = schemaProps.filter(
      (k) => !new RegExp(`^\\s{2}${k}\\??:`, 'm').test(body),
    );
    expect(untyped, 'canonical properties with no BlockManifestV1 key').toEqual([]);
  });

  /**
   * 🔴 THE SAME GAP, ONE LEVEL DOWN — and the level where it is most likely to
   * reopen. The guard above is TOP-LEVEL only, so adding
   * `goods.items.properties.badgeUrl` to the vendored schema passed a fully
   * green suite while `defineBlock` rejected the very same manifest with
   * TS2353: exactly the failure class this change exists to close, just nested.
   * `goods[]` is the newest of these shapes and the likeliest to grow.
   *
   * Nothing here is hand-listed except the LEDGER below. The nested shapes are
   * DERIVED from the schema (any top-level property that is an object with
   * `properties`, or an array whose `items` is), and the interface that types
   * each one is read off `BlockManifestV1`'s own declaration — so a shape the
   * schema grows is covered the moment someone extends the ledger, rather than
   * needing a new test written for it.
   */
  it('every canonical NESTED property is TYPED on the interface that models it', () => {
    const src = readFileSync(new URL('../../src/blocks/types.ts', import.meta.url), 'utf8');
    const manifestBody = interfaceBody(src, 'BlockManifestV1');
    expect(manifestBody, 'interface BlockManifestV1 not found in types.ts').not.toBe('');

    /**
     * Top-level schema properties whose value shape carries its own
     * `properties` — directly, or as an array's `items`.
     *
     * 🔴 KEYED ON `properties`, NOT ON `type === 'object'`, and the difference
     * is what the ledger below is worth. JSON Schema does not require `type`,
     * so a nested shape written without it — the common form once a schema
     * starts composing — would not have been collected, the ledger would still
     * have matched its expected keys, and the TS2353 gap this test exists
     * to close would have reopened silently. A shape's own `properties` is the
     * thing this test actually reads, so it is the right thing to select on.
     *
     * ⚠️ RESIDUAL, AND DELIBERATELY NOT PAPERED OVER: a nested object reached
     * through `$ref`, `oneOf`, `anyOf` or `allOf` carries no inline
     * `properties`, so it is still invisible here and the ledger would still
     * match. The canonical schema composes no FIRST-LEVEL shape that way today
     * (measured: the shapes ledgered below are the complete first-level set). Resolving
     * them needs a real schema walk rather than a wider predicate, and the
     * honest statement is that this guard covers INLINE shapes only — so the
     * "fails when the set GROWS" claim below is scoped to those. (Below the
     * first level, composition IS read: see the DEEP test further down, which
     * walks `patternProperties`, `allOf`, `oneOf` and `anyOf`.)
     */
    const nested: { key: string; props: string[] }[] = [];
    for (const [key, def] of Object.entries(schema.properties ?? {})) {
      const shape = def as unknown as {
        properties?: Record<string, unknown>;
        items?: { properties?: Record<string, unknown> };
      };
      const objectShape =
        shape && typeof shape === 'object' && 'properties' in shape && shape.properties
          ? shape.properties
          : shape?.items &&
              typeof shape.items === 'object' &&
              'properties' in shape.items &&
              shape.items.properties
            ? shape.items.properties
            : null;
      if (objectShape) nested.push({ key, props: Object.keys(objectShape) });
    }

    // 🔴 LEDGER, not a filter. It fails when the set of INLINE nested shapes
    // GROWS (the schema gained one nobody has looked at) AND when it SHRINKS
    // (the derivation stopped finding them, which would make every assertion
    // below vacuous — the failure mode a plain `forEach` over an empty list
    // cannot show). It cannot see a shape composed via `$ref`/`oneOf`/`anyOf`;
    // see the derivation's note above.
    //
    // A `TYPED_AHEAD` shape is expected only once the vendored schema carries
    // it; see that list for why it exists.
    const LEDGER = ['analytics', 'goods', 'iframe', 'page', 'targets'];
    const present = new Set(Object.keys(schema.properties ?? {}));
    const expected = [...LEDGER, ...TYPED_AHEAD.filter((k) => present.has(k))].sort();
    expect(
      nested.map((n) => n.key).sort(),
      'nested object shapes in the canonical schema',
    ).toEqual(expected);

    const untyped: string[] = [];
    for (const { key, props } of nested) {
      // `goods?: BlockManifestGood[];` → `BlockManifestGood`. An INLINE object
      // literal captures nothing, which fails the next assertion by name rather
      // than silently skipping the shape.
      const named = new RegExp(`^\\s{2}${key}\\??:\\s*([A-Za-z_$][\\w$]*)`, 'm').exec(manifestBody);
      expect(named?.[1], `BlockManifestV1.${key} must be typed by a named interface`).toBeTruthy();
      const nestedBody = interfaceBody(src, named![1]);
      // Positive control on the parse: a typo'd or renamed interface yields an
      // empty body, under which EVERY property below "matches nothing" and the
      // whole shape would report clean.
      expect(nestedBody, `interface ${named![1]} not found in types.ts`).not.toBe('');
      for (const p of props) {
        if (!new RegExp(`^\\s{2}${p}\\??:`, 'm').test(nestedBody)) {
          untyped.push(`${key}.${p} (missing on ${named![1]})`);
        }
      }
    }
    expect(untyped, 'canonical nested properties with no interface key').toEqual([]);
  });

  /**
   * 🔴 THE SAME GAP, AT ANY DEPTH. The two tests above read one level of
   * inline `properties`. `analytics` is the first canonical shape that nests
   * further through `patternProperties` (a map keyed by event name) and
   * `allOf`/`oneOf` (the property-declaration union), so a canonical that added
   * `analytics.events.<name>.category` kept the whole suite green while
   * `defineBlock`'s inline form rejected `category` with TS2353 and Ajv
   * accepted it. This walks every shape below the first level and checks its
   * keys against the type the COMPILER resolves at the same path.
   */
  it('every canonical DEEP property (below the first level, any composition) is TYPED', () => {
    const shapes = schemaShapes(schema);
    // Positive control on the walker: it must find the first-level shapes the
    // test above ledgers, or every assertion below is about an empty map.
    expect(shapes.has('iframe') && shapes.has('goods[]')).toBe(true);

    // 🔴 LEDGER of deep shape PATHS, failing when the set GROWS (a deep shape
    // nobody has typed or looked at) or SHRINKS (the walker stopped finding
    // one, which would make the key check below vacuous for it). Typed-ahead
    // paths are expected only when the vendored schema carries them.
    const DEEP_LEDGER = ['analytics.events.*', 'analytics.events.*.properties.*'];
    const deep = [...shapes.keys()].filter((p) => p.includes('.')).sort();
    const expected = [
      ...DEEP_LEDGER,
      ...DEEP_TYPED_AHEAD.filter((p) => {
        const top = p.split('.')[0]!;
        return Object.keys(schema.properties ?? {}).includes(top);
      }),
    ].sort();
    expect(deep, 'deep object shapes in the canonical schema').toEqual(expected);

    // Every key the schema declares on a deep shape must be a key of the type
    // at that path. DELIBERATELY ONE-WAY (schema keys ⊆ typed keys, not
    // equality): this repo types a new field before the published schema
    // carries it, so a type with a key the bytes do not have yet is the normal
    // state for a while, and an exact match would turn that window red.
    const untyped: string[] = [];
    for (const path of deep) {
      const typed = typeKeysAt(path);
      if (typed === null || typed.size === 0) {
        untyped.push(`${path} (no type resolves at this path from BlockManifestV1)`);
        continue;
      }
      for (const k of shapes.get(path)!) {
        if (!typed.has(k)) untyped.push(`${path}.${k}`);
      }
    }
    expect(untyped, 'canonical deep properties with no type key').toEqual([]);
  });

  it('the deep type resolver can see the analytics declaration types (positive control)', () => {
    // The deep test already fails on a path that resolves to nothing. This
    // pins that the resolver follows each path KIND to the right type — a map
    // value (`*`), a union's members, an array's items (`[]`) — rather than to
    // some other non-empty type. `arrayContaining`, not equality: the key check
    // is one-way, so the type may carry a key the schema does not have yet.
    expect([...(typeKeysAt('analytics.events.*') ?? [])]).toEqual(
      expect.arrayContaining(['description', 'properties']),
    );
    expect([...(typeKeysAt('analytics.events.*.properties.*') ?? [])]).toEqual(
      expect.arrayContaining(['type', 'values']),
    );
    expect([...(typeKeysAt('goods[]') ?? [])]).toContain('priceBuzz');
    expect(typeKeysAt('analytics.nope.*')).toBeNull();
  });

  it('the scopes enum holds exactly BLOCK_SCOPES — fails if either side grows OR shrinks', () => {
    const schemaEnum = schema.properties.scopes?.items?.enum;
    // Positive control. A moved JSON path yields `undefined`, which would throw
    // an opaque TypeError below; this names the failure instead. It is a
    // DIAGNOSTIC, not additional coverage — say so rather than counting it.
    expect(Array.isArray(schemaEnum)).toBe(true);
    expect(schemaEnum!.length).toBeGreaterThan(0);

    // Sorted arrays, not Sets: the failure output then names the offending
    // strings on both sides.
    expect([...schemaEnum!].sort()).toEqual([...Object.values(BLOCK_SCOPES)].sort());
  });

  /**
   * 🔴 NOT SUBSUMED BY THE ASSERTION ABOVE — an audit argued it was, and the
   * argument is refutable by counter-example, so it is recorded here rather
   * than re-litigated. Two `BLOCK_SCOPES` KEYS may legally share one VALUE
   * (`{ X: 'a', Y: 'a' }`), so against a schema enum `['a','a','b']` the sorted
   * arrays are EQUAL and the equality above passes while a duplicate exists.
   * This is the only assertion that fires in that state.
   */
  it('the scopes enum has no duplicates', () => {
    // 🔴 NO `?? []` DEFAULT, deliberately. An empty array satisfies
    // `Set(x).size === x.length` trivially, so defaulting would make this pass
    // vacuously under exactly the failure its sibling's positive control exists
    // to catch — a moved JSON path. Measured: with `?? []` and the path moved
    // to `.oneOfEnum`, this test alone reported PASS.
    const schemaEnum = schema.properties.scopes?.items?.enum;
    expect(Array.isArray(schemaEnum)).toBe(true);
    expect(new Set(schemaEnum!).size).toBe(schemaEnum!.length);
  });
});
