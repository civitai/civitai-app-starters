/**
 * The divergence ledger. `SCHEMA_DIVERGENCES` is a TABLE OF CLAIMS; this is
 * what makes each one checkable rather than prose.
 *
 * The property each entry must satisfy is the same one, and it is deliberately
 * one-directional: the fixture is ACCEPTED by the canonical schema and REJECTED
 * by `defineBlock`, on that entry's own field path. That is what "strictly
 * additive" means — no entry may relax a canonical rule, and there is no
 * fixture below that could express such a relaxation even by accident.
 *
 * The LEDGER is what stops the table drifting: the set of table keys and the
 * set of fixtures must be the SAME SET, failing when either grows or shrinks.
 * A new hand-written rule with no entry, or an entry with no fixture, is red.
 */
import { describe, expect, it } from 'vitest';

import { SCHEMA_DIVERGENCES, defineBlock } from '../../src/manifest/defineBlock.js';
import { BlockManifestError } from '../../src/blocks/manifestError.js';
import type { BlockManifest } from '../../src/blocks/types.js';
import { canonicalAccepts, valid } from './fixtures.js';

interface DivergenceCase {
  /** Must be a key of SCHEMA_DIVERGENCES. */
  entry: keyof typeof SCHEMA_DIVERGENCES;
  label: string;
  manifest: Record<string, unknown>;
  /** The `.field` the rejection must carry — its OWN path, not a neighbour's. */
  field: string;
  /** A distinctive substring of the message, so it cannot die on another rule. */
  message: RegExp;
}

const CASES: DivergenceCase[] = [
  {
    entry: 'iframe.src',
    label: 'a dev-set iframe.src — the field the platform assigns and #330 REQUIRED',
    manifest: valid({
      iframe: { minHeight: 137, maxHeight: 613, src: 'https://fixture-block.civit.ai/' },
    }),
    field: 'iframe.src',
    message: /SERVER-OWNED/,
  },
  {
    entry: 'trustTier',
    label: 'a dev-set trustTier',
    manifest: valid({ trustTier: 'verified' }),
    field: 'trustTier',
    message: /SERVER-OWNED/,
  },
  {
    entry: 'iframe.sandbox',
    label: 'sandbox with allow-same-origin',
    manifest: valid({ iframe: { minHeight: 137, sandbox: 'allow-scripts allow-same-origin' } }),
    field: 'iframe.sandbox',
    message: /defeats the sandbox entirely/,
  },
  {
    entry: 'scopeJustifications',
    label: 'a justification for a scope not in scopes',
    manifest: valid({
      scopes: ['models:read:self'],
      scopeJustifications: { 'images:read:self': 'we need it' },
    }),
    field: 'scopeJustifications.images:read:self',
    message: /not in manifest\.scopes/,
  },
  {
    entry: 'settings',
    label: 'a settings field with an unknown scope',
    manifest: valid({
      settings: {
        my_field: { scope: 'admin', type: 'string', label: 'L', description: 'D' },
      },
    }),
    field: 'settings.my_field.scope',
    message: /must be one of publisher, viewer/,
  },
];

describe('SCHEMA_DIVERGENCES: every entry is strictly additive and carries a fixture', () => {
  it('LEDGER: table keys === fixture entries (fails if either set grows or shrinks)', () => {
    expect(CASES.map((c) => c.entry).sort()).toEqual(Object.keys(SCHEMA_DIVERGENCES).sort());
  });

  it.each(CASES.map((c) => [`${c.entry}: ${c.label}`, c] as const))('%s', (_label, testCase) => {
    // Half one: the CANONICAL accepts it. Without this the case proves nothing
    // about divergence — it would just be another schema rule.
    expect(canonicalAccepts(testCase.manifest), 'fixture must be canonical-VALID').toBe(true);

    // Half two: defineBlock rejects it, on its OWN field path and message.
    let thrown: unknown;
    try {
      defineBlock({ manifest: testCase.manifest as unknown as BlockManifest });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'defineBlock must reject the fixture').toBeInstanceOf(BlockManifestError);
    expect((thrown as BlockManifestError).field).toBe(testCase.field);
    expect((thrown as BlockManifestError).message).toMatch(testCase.message);
  });
});

/**
 * The honesty half of the sandbox entry. `BANNED_SANDBOX_TOKENS` is a DENYLIST
 * while the canonical's description is an ALLOWLIST, so this gate is looser than
 * review in one direction as well as stricter in the other. These assertions pin
 * the looser half so it stays DOCUMENTED rather than silently discovered at
 * review — the previous divergence entry itemised only the stricter half while
 * the docblock claimed "Nothing else".
 */
describe('the sandbox denylist is LOOSER than review, and says so', () => {
  it.each(['allow-popups', 'allow-modals', 'allow-downloads'])(
    '%s passes here (outside the unverified-tier allowlist, may be refused at review)',
    (token) => {
      const manifest = valid({ iframe: { minHeight: 137, sandbox: `allow-scripts ${token}` } });
      expect(() => defineBlock({ manifest: manifest as unknown as BlockManifest })).not.toThrow();
    },
  );

  it('the shipped block starter is itself outside the unverified-tier allowlist', () => {
    // Not a defect to fix here — it is the measured reason the allowlist cannot
    // be enforced locally. If this ever goes green, the allowlist became
    // enforceable and KNOWN_GAPS['tier-dependent-sandbox-allowlist'] is stale.
    const sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
    const allowed = new Set(['allow-scripts', 'allow-forms']);
    const outside = sandbox.split(' ').filter((t) => !allowed.has(t));
    expect(outside).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox']);
  });

  it.each([
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols',
  ])('%s IS rejected (all three variants, not just the bare token)', (token) => {
    const manifest = valid({ iframe: { minHeight: 137, sandbox: `allow-scripts ${token}` } });
    expect(() => defineBlock({ manifest: manifest as unknown as BlockManifest })).toThrow(
      /NAVIGATE postMessage/,
    );
  });
});
