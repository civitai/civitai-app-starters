/**
 * DIFFERENTIAL parity between the canonical JSON schema and `defineBlock`.
 *
 * The vendored schema (`schemas/app-block/v1.json`) is a byte-identical copy of
 * the server-published canonical at https://civitai.com/schemas/app-block/v1.json
 * (enforced by CI's `schema-drift` job / `scripts/check-canonical-schema.sh`).
 *
 * THE METHOD CHANGED IN #330, and that is the point. This file used to check a
 * handful of constants by hand and then assert, in a comment, that `defineBlock`
 * was a "strict client-side SUPERSET gate" — while the function it tested
 * announced itself as a strict SUBSET. Both were wrong, in different directions,
 * and the hand-picked constant checks could not see it: they only ever looked at
 * rules somebody remembered to look at.
 *
 * What runs now is a differential. Ajv compiles the vendored schema; every
 * fixture in CORPUS is judged by BOTH the schema and `defineBlock`, and the two
 * verdicts must AGREE — unless the fixture names an entry in
 * `SCHEMA_DIVERGENCES`, in which case they must DISAGREE and the named entry
 * must exist. So a hand-written rule that drifts above or below the canonical
 * fails here with no new test needed, which is the failure mode #330 was.
 *
 * Three guards keep the differential itself honest:
 *   - the base fixture must be accepted by BOTH (a corpus built on a rejected
 *     base would make every single-field mutation vacuous);
 *   - Ajv must be able to say NO (negative control — a deliberately broken
 *     fixture); and
 *   - every key in `SCHEMA_DIVERGENCES` must be exercised by at least one
 *     fixture, so the table cannot claim coverage it does not have.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { defineBlock, KNOWN_GAPS, SCHEMA_DIVERGENCES } from '../../src/blocks/defineBlock.js';
import {
  BLOCK_CATEGORIES,
  BLOCK_SCOPES,
  BLOCK_TAGLINE_MAX_LENGTH,
} from '../../src/blocks/scopes.js';
import type { BlockManifest } from '../../src/blocks/types.js';

const SCHEMA_PATH = join(__dirname, '../../schemas/app-block/v1.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;

// `strict: false` — the canonical carries `$comment` keys and a `format: uri`
// this test has no business re-interpreting. `validateFormats: false` for the
// same reason: `assetBundleUrl`'s real rule is its `pattern`, which IS checked.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateAgainstSchema = ajv.compile(schema);

type AnyManifest = Record<string, unknown>;

/** Accepted by the canonical schema AND by `defineBlock`. */
function valid(overrides: AnyManifest = {}): AnyManifest {
  return {
    $schema: 'https://civitai.com/schemas/app-block/v1.json',
    blockId: 'my-block',
    version: '0.1.0',
    name: 'My Block',
    type: 'block',
    targets: [{ slotId: 'model.sidebar_top', priority: 100 }],
    scopes: ['models:read:self'],
    iframe: {
      minHeight: 200,
      maxHeight: 600,
      resizable: true,
      sandbox: 'allow-scripts allow-forms',
    },
    contentRating: 'pg',
    minApiVersion: '1.0',
    ...overrides,
  };
}

/** Same fixture with one key deleted (mutations that REMOVE rather than change). */
function without(key: string, overrides: AnyManifest = {}): AnyManifest {
  const m = valid(overrides);
  delete m[key];
  return m;
}

function schemaAccepts(manifest: AnyManifest): boolean {
  return validateAgainstSchema(manifest) === true;
}

function gateAccepts(manifest: AnyManifest): boolean {
  try {
    defineBlock({ manifest: manifest as unknown as BlockManifest });
    return true;
  } catch {
    return false;
  }
}

type DivergenceKey = keyof typeof SCHEMA_DIVERGENCES;
interface Fixture {
  name: string;
  manifest: AnyManifest;
  /** Set when the two verdicts are EXPECTED to disagree; names the table entry. */
  divergence?: DivergenceKey;
  /**
   * Which way the disagreement runs. `stricter` (the default) = the canonical
   * accepts and `defineBlock` refuses. `looser` = the canonical refuses and
   * `defineBlock` accepts — which is only ever legitimate when the extra
   * permission mirrors the SERVER (today: `tagline`, which the server measures
   * after trimming while the schema's `maxLength` counts the raw string).
   * Naming the direction is the difference between "we checked" and "we looked
   * at a boolean and shrugged".
   */
  direction?: 'stricter' | 'looser';
}

/**
 * One fixture per rule. Fixture values are chosen distinct from any constant an
 * assertion names, so a mutant that hardcodes a literal cannot survive.
 */
const CORPUS: Fixture[] = [
  // ---- the base, and the relaxations #330 had to make -------------------
  { name: 'the base fixture', manifest: valid() },
  { name: 'no $schema', manifest: without('$schema') },
  { name: 'no type', manifest: without('type') },
  { name: 'no targets (page-only app)', manifest: without('targets') },
  { name: 'no iframe', manifest: without('iframe') },
  { name: 'no minApiVersion', manifest: without('minApiVersion') },
  { name: 'no appId (never was canonical)', manifest: valid() },
  { name: 'empty scopes array', manifest: valid({ scopes: [] }) },
  { name: 'a 137-character name (the canonical caps nothing)', manifest: valid({ name: 'x'.repeat(137) }) },
  { name: 'iframe with only sandbox', manifest: valid({ iframe: { sandbox: 'allow-scripts' } }) },
  { name: 'iframe.maxHeight null', manifest: valid({ iframe: { minHeight: 137, maxHeight: null } }) },
  { name: 'the shape the starters ship', manifest: without('type', {
    targets: [{ slotId: 'model.sidebar_top', priority: 100, requiredContext: ['modelId'] }],
    bootSkeleton: true,
    iframe: { minHeight: 220, maxHeight: 613, resizable: true, sandbox: 'allow-scripts allow-forms' },
  }) },

  // ---- rules both sides enforce, agreeing on REJECT ---------------------
  { name: 'blockId with uppercase', manifest: valid({ blockId: 'BadId' }) },
  { name: 'blockId of 2 chars', manifest: valid({ blockId: 'ab' }) },
  { name: 'blockId of 41 chars', manifest: valid({ blockId: `a${'b'.repeat(40)}` }) },
  { name: 'blockId starting with a digit', manifest: valid({ blockId: '1block' }) },
  { name: 'non-semver version', manifest: valid({ version: 'not-semver' }) },
  { name: 'empty name', manifest: valid({ name: '' }) },
  { name: "type 'embed'", manifest: valid({ type: 'embed' }) },
  { name: "type 'widget'", manifest: valid({ type: 'widget' }) },
  { name: 'unknown contentRating', manifest: valid({ contentRating: 'mature' }) },
  { name: 'unknown category', manifest: valid({ category: 'nonsense' }) },
  { name: 'unknown scope', manifest: valid({ scopes: ['foo:bar:baz'] }) },
  { name: 'PascalCase scope', manifest: valid({ scopes: ['ModelsReadSelf'] }) },
  { name: '17 targets (canonical maxItems 16)', manifest: valid({
    targets: Array.from({ length: 17 }, (_, i) => ({ slotId: `slot.${i}` })),
  }) },
  { name: 'a target with no slotId', manifest: valid({ targets: [{ priority: 3 }] }) },
  { name: 'iframe.minHeight below the 40px floor', manifest: valid({ iframe: { minHeight: 39 } }) },
  { name: 'iframe.minHeight above the 4000px ceiling', manifest: valid({ iframe: { minHeight: 4001 } }) },
  { name: 'fractional iframe.minHeight', manifest: valid({ iframe: { minHeight: 137.5 } }) },
  { name: 'iframe.maxHeight above the ceiling', manifest: valid({ iframe: { maxHeight: 4137 } }) },
  { name: 'an unknown iframe key', manifest: valid({ iframe: { minHeight: 137, loading: 'lazy' } }) },
  { name: 'iframe.resizable as a string', manifest: valid({ iframe: { resizable: 'yes' } }) },
  { name: 'empty iframe.sandbox', manifest: valid({ iframe: { sandbox: '' } }) },
  { name: 'minApiVersion with a letter', manifest: valid({ minApiVersion: '1.0.x' }) },
  { name: 'unknown renderMode', manifest: valid({ renderMode: 'popover' }) },
  { name: 'bootSkeleton as a string', manifest: valid({ bootSkeleton: 'yes' }) },
  { name: 'tagline one char over the cap', manifest: valid({ tagline: 'a'.repeat(BLOCK_TAGLINE_MAX_LENGTH + 1) }) },
  { name: 'whitespace-only tagline', manifest: valid({ tagline: '   ' }) },
  { name: 'a valid tagline', manifest: valid({ tagline: 'A crisp one-liner' }) },
  { name: 'a repository root URL', manifest: valid({ repository: 'https://github.com/civitai/civitai-app-starters' }) },
  { name: 'a repository deep link', manifest: valid({ repository: 'https://github.com/owner/repo/tree/main' }) },
  { name: 'a repository on a disallowed host', manifest: valid({ repository: 'https://example.com/owner/repo' }) },
  { name: 'a 201-character repository URL', manifest: valid({
    repository: `https://github.com/${'a'.repeat(180)}/b`,
  }) },
  { name: 'a disallowed buildCommand', manifest: valid({ buildCommand: 'rm -rf /', outputDir: 'dist' }) },
  { name: 'buildCommand without outputDir', manifest: valid({ buildCommand: 'pnpm run build' }) },
  { name: 'buildCommand with outputDir', manifest: valid({ buildCommand: 'pnpm run build', outputDir: 'dist' }) },
  { name: 'outputDir with a traversal segment', manifest: valid({ outputDir: '../escape' }) },
  { name: 'an absolute outputDir', manifest: valid({ outputDir: '/srv/dist' }) },
  { name: 'a Windows-drive outputDir', manifest: valid({ outputDir: 'C:/dist' }) },
  { name: '33 publicSettingsKeys', manifest: valid({
    publicSettingsKeys: Array.from({ length: 33 }, (_, i) => `k${i}`),
  }) },
  { name: 'a 65-character publicSettingsKey', manifest: valid({ publicSettingsKeys: ['k'.repeat(65)] }) },
  { name: 'a plain-http assetBundleUrl', manifest: valid({ assetBundleUrl: 'http://cdn.example.com/b.zip' }) },
  { name: 'an https assetBundleUrl', manifest: valid({ assetBundleUrl: 'https://cdn.example.com/b.zip' }) },
  { name: 'a 501-character scope justification', manifest: valid({
    scopeJustifications: { 'models:read:self': 'j'.repeat(501) },
  }) },
  { name: 'a valid scope justification', manifest: valid({
    scopeJustifications: { 'models:read:self': 'Reads the viewer’s own models to pre-fill the form.' },
  }) },
  { name: 'a page with no title', manifest: valid({ page: { path: '/board' } }) },
  { name: 'a page path with no leading slash', manifest: valid({ page: { path: 'board', title: 'Board' } }) },
  { name: 'a page with an unknown key', manifest: valid({ page: { path: '/board', title: 'Board', theme: 'dark' } }) },
  { name: 'a page buzzBudgetPerGen of 0', manifest: valid({ page: { path: '/board', title: 'Board', buzzBudgetPerGen: 0 } }) },
  { name: 'a valid page', manifest: valid({ page: { path: '/board', title: 'Board', buzzBudgetPerGen: 137 } }) },

  // ---- the documented divergences ---------------------------------------
  { name: 'a wrong $schema URL', manifest: valid({ $schema: 'https://example.com/wrong.json' }), divergence: '$schema' },
  { name: 'a non-string appId', manifest: valid({ appId: 137 }), divergence: 'appId' },
  { name: 'a fractional target priority', manifest: valid({ targets: [{ slotId: 'model.sidebar_top', priority: 1.5 }] }), divergence: 'targets[].priority' },
  { name: 'a dev-set iframe.src', manifest: valid({ iframe: { minHeight: 137, src: 'https://my-block.civit.ai/' } }), divergence: 'iframe.src' },
  { name: 'a dev-set trustTier', manifest: valid({ trustTier: 'verified' }), divergence: 'trustTier' },
  { name: 'sandbox with allow-same-origin', manifest: valid({ iframe: { sandbox: 'allow-scripts allow-same-origin' } }), divergence: 'iframe.sandbox' },
  { name: 'sandbox with allow-top-navigation-by-user-activation', manifest: valid({ iframe: { sandbox: 'allow-scripts allow-top-navigation-by-user-activation' } }), divergence: 'iframe.sandbox' },
  { name: 'a justification for an undeclared scope', manifest: valid({ scopeJustifications: { 'buzz:read:self': 'why' } }), divergence: 'scopeJustifications' },
  { name: 'a tagline padded past the raw cap but fitting when trimmed', manifest: valid({
    tagline: `   ${'a'.repeat(BLOCK_TAGLINE_MAX_LENGTH)}   `,
  }), divergence: 'tagline', direction: 'looser' },
  { name: 'an asset with a non-SRI integrity', manifest: valid({
    assets: [{ url: 'https://cdn.example.com/a.js', integrity: 'md5-deadbeef' }],
  }), divergence: 'assets' },
  { name: 'a setting key that is not snake_case', manifest: valid({
    settings: { BadKey: { scope: 'publisher', type: 'boolean', label: 'L', description: 'D' } },
  }), divergence: 'settings' },
];

describe('the differential harness itself', () => {
  it('Ajv accepts the base fixture (without this every mutation is vacuous)', () => {
    expect(validateAgainstSchema(valid())).toBe(true);
  });

  it('Ajv can say NO (negative control)', () => {
    // Built from a realistic manifest with ONE realistic mistake, not a
    // textbook fixture — a validator wired to nothing would pass this too if
    // the mistake were exotic enough to be special-cased.
    expect(validateAgainstSchema(valid({ contentRating: 'mature' }))).toBe(false);
  });

  it('every SCHEMA_DIVERGENCES entry is exercised by at least one fixture', () => {
    const exercised = new Set(CORPUS.map((f) => f.divergence).filter(Boolean));
    expect([...Object.keys(SCHEMA_DIVERGENCES)].sort()).toEqual([...exercised].sort());
  });

  it('every divergence entry states a rule, the canonical position, and a reason', () => {
    for (const [key, entry] of Object.entries(SCHEMA_DIVERGENCES)) {
      expect(entry.rule.length, `${key}.rule`).toBeGreaterThan(20);
      expect(entry.canonical.length, `${key}.canonical`).toBeGreaterThan(20);
      expect(entry.reason.length, `${key}.reason`).toBeGreaterThan(40);
    }
  });

  it('the known-gap ledger is non-empty and names the sensitive-scope rule', () => {
    // A green defineBlock is necessary, not sufficient. If this list ever
    // empties, the docblock's necessary-not-sufficient wording is a lie.
    expect(KNOWN_GAPS.length).toBeGreaterThan(0);
    expect(KNOWN_GAPS).toContain('scopeJustifications-required-for-sensitive-scopes');
  });
});

describe('canonical schema ↔ defineBlock differential', () => {
  it.each(CORPUS.map((f) => [f.name, f] as const))('%s', (_label, fixture) => {
    const bySchema = schemaAccepts(fixture.manifest);
    const byGate = gateAccepts(fixture.manifest);
    if (fixture.divergence) {
      const stricter = (fixture.direction ?? 'stricter') === 'stricter';
      const why = SCHEMA_DIVERGENCES[fixture.divergence].reason;
      // Pin BOTH verdicts, not just the disagreement. `bySchema !== byGate`
      // alone is satisfied by the pair flipping wholesale, which would mean the
      // divergence had inverted direction without any test noticing.
      expect(bySchema, `${fixture.name}: canonical verdict — ${why}`).toBe(stricter);
      expect(byGate, `${fixture.name}: defineBlock verdict — ${why}`).toBe(!stricter);
    } else {
      expect(
        byGate,
        `${fixture.name}: schema says ${bySchema ? 'VALID' : 'INVALID'}, defineBlock says ${byGate ? 'VALID' : 'INVALID'} — ` +
          'either fix defineBlock or add an entry to SCHEMA_DIVERGENCES with a reason',
      ).toBe(bySchema);
    }
  });
});

describe('required-field parity', () => {
  const schemaRequired = (schema.required as string[]) ?? [];

  it('the canonical requires exactly five fields', () => {
    expect(new Set(schemaRequired)).toEqual(
      new Set(['blockId', 'version', 'name', 'contentRating', 'scopes']),
    );
  });

  it.each(schemaRequired)('defineBlock rejects a manifest missing %s', (field) => {
    expect(gateAccepts(without(field))).toBe(false);
  });

  it.each(
    Object.keys(valid()).filter((k) => !schemaRequired.includes(k)),
  )('defineBlock accepts a manifest missing the OPTIONAL %s', (field) => {
    // This is the arm that was red for six fields at 9a060f3 ($schema, appId,
    // type, targets, iframe, minApiVersion) — the "11 required vs 5" defect,
    // pinned as behaviour rather than as a constant.
    expect(gateAccepts(without(field))).toBe(true);
  });
});

describe('enum drift guards (schema constant ↔ SDK constant)', () => {
  it('scopes enum === BLOCK_SCOPES', () => {
    const scopeItems = (schema.properties as Record<string, { items?: { enum?: string[]; pattern?: string } }>)
      .scopes?.items;
    expect(scopeItems?.pattern).toBeUndefined();
    expect(new Set(scopeItems?.enum)).toEqual(new Set(Object.values(BLOCK_SCOPES)));
    for (const scope of Object.values(BLOCK_SCOPES)) {
      expect(gateAccepts(valid({ scopes: [scope] })), scope).toBe(true);
    }
  });

  it('category enum === BLOCK_CATEGORIES', () => {
    const categorySchema = (schema.properties as Record<string, { enum?: string[] }>).category;
    expect(categorySchema?.enum).toEqual([...BLOCK_CATEGORIES]);
    for (const category of BLOCK_CATEGORIES) {
      expect(gateAccepts(valid({ category })), category).toBe(true);
    }
  });

  it('tagline maxLength === BLOCK_TAGLINE_MAX_LENGTH', () => {
    const taglineSchema = (schema.properties as Record<string, { maxLength?: number; pattern?: string }>)
      .tagline;
    expect(taglineSchema?.maxLength).toBe(BLOCK_TAGLINE_MAX_LENGTH);
    expect(taglineSchema?.pattern).toBe('\\S');
  });

  it("type enum is ['block'] — 'embed' is NOT canonical", () => {
    // The heading this test replaced claimed it "shares the canonical
    // manifest.type enum" while only ever trying 'widget'. 'embed' was the one
    // value `defineBlock` wrongly accepted, and the one value the old test
    // could not see.
    const enumVals = (schema.properties as Record<string, { enum?: string[] }>).type?.enum;
    expect(enumVals).toEqual(['block']);
    expect(gateAccepts(valid({ type: 'embed' }))).toBe(false);
    expect(gateAccepts(valid({ type: 'block' }))).toBe(true);
  });

  it('iframe bounds are 40..4000 and iframe forbids unknown keys', () => {
    const iframeSchema = (schema.properties as Record<string, {
      additionalProperties?: boolean;
      properties?: Record<string, { type?: unknown; minimum?: number; maximum?: number }>;
    }>).iframe;
    expect(iframeSchema?.additionalProperties).toBe(false);
    expect(iframeSchema?.properties?.minHeight?.minimum).toBe(40);
    expect(iframeSchema?.properties?.minHeight?.maximum).toBe(4000);
    expect(iframeSchema?.properties?.maxHeight?.type).toEqual(['integer', 'null']);
  });

  it('the canonical top level does not forbid additional properties', () => {
    // What makes tolerating `appId` / `assets` / `settings` legitimate.
    expect(schema.additionalProperties).not.toBe(false);
  });
});
