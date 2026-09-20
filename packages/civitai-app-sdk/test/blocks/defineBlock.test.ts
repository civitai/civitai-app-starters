/**
 * Unit coverage for `defineBlock`'s error surface — the `.field` dot-paths and
 * the pointed messages an author actually reads.
 *
 * The CONTRACT (which rules exist at all, and how they line up with the
 * canonical schema) is pinned by `schema-parity.test.ts`, which runs Ajv over
 * the vendored schema and demands the two verdicts agree except where
 * `SCHEMA_DIVERGENCES` says otherwise. This file is about ergonomics: a wrong
 * manifest must say WHICH field and WHY.
 *
 * Reshaped by #330. The fixture below is the shape the starters actually ship:
 * five canonical-required fields, no `iframe.src` (the platform stamps it), and
 * `appId` present but inert. Every `relaxed by #330` case is a rule that used
 * to fire and must not any more.
 */
import { describe, expect, it } from 'vitest';

import { BlockManifestError, defineBlock } from '../../src/blocks/defineBlock.js';
import type { BlockManifest } from '../../src/blocks/types.js';

function validManifest(overrides: Partial<BlockManifest> = {}): BlockManifest {
  return {
    $schema: 'https://civitai.com/schemas/app-block/v1.json',
    appId: 'app_test',
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

/** Field-path + message assertion in one, so a guard can't die on a neighbour's error. */
function expectRejection(manifest: unknown, field: string, message: RegExp): void {
  try {
    defineBlock({ manifest: manifest as BlockManifest });
    expect.unreachable(`expected a BlockManifestError on ${field}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BlockManifestError);
    expect((err as BlockManifestError).field, 'field dot-path').toBe(field);
    expect((err as Error).message).toMatch(message);
  }
}

describe('defineBlock', () => {
  it('returns the manifest unchanged when valid', () => {
    const manifest = validManifest();
    expect(defineBlock({ manifest })).toBe(manifest);
  });

  it('accepts a manifest with every optional field populated', () => {
    const manifest = validManifest({
      category: 'utility',
      tagline: 'A crisp one-liner',
      repository: 'https://github.com/civitai/civitai-app-starters',
      renderMode: 'hybrid',
      bootSkeleton: true,
      buildCommand: 'pnpm run build',
      outputDir: 'dist',
      publicSettingsKeys: ['show_advanced'],
      assetBundleUrl: 'https://cdn.example.com/bundle.zip',
      scopeJustifications: { 'models:read:self': 'Pre-fills the form from the viewer’s models.' },
      page: { path: '/board', title: 'Board', icon: 'grid', buzzBudgetPerGen: 750 },
      assets: [
        { url: 'https://cdn.example.com/a.js', integrity: 'sha384-AAAAAAAAAAAAAAAAAAAA' },
      ],
      settings: {
        // W3 v0 — record keyed by snake_case field name.
        theme: {
          scope: 'publisher',
          type: 'string',
          widget: 'select',
          label: 'Theme',
          description: 'Light or dark.',
          enum: ['light', 'dark'],
          default: 'light',
        },
        count: {
          scope: 'publisher',
          type: 'number',
          widget: 'number',
          label: 'Count',
          description: 'How many items.',
          min: 0,
          max: 10,
          default: 1,
        },
      },
      preview: {
        thumbnail: 'https://cdn.example.com/thumb.png',
        description: 'desc',
        screenshots: ['https://cdn.example.com/s1.png'],
      },
      promotionEligible: true,
      assetBundle: { url: null, sha256: null },
    });
    expect(() => defineBlock({ manifest })).not.toThrow();
  });

  describe('server-owned fields are refused, not required (#330)', () => {
    it('rejects a dev-set iframe.src — the platform stamps the bundle URL', () => {
      // THE headline defect: this validator used to REQUIRE the one value
      // `civitai app submit` refuses, so every correct manifest failed locally
      // and every locally-passing manifest failed at submit.
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, src: 'https://my-block.civit.ai/' } as never,
      });
      expectRejection(manifest, 'iframe.src', /SERVER-OWNED/);
    });

    it('rejects a dev-set trustTier — the platform assigns it during review', () => {
      const manifest = validManifest({ trustTier: 'verified' as never });
      expectRejection(manifest, 'trustTier', /SERVER-OWNED/);
    });
  });

  describe('relaxed by #330 — rules that used to fire and must not', () => {
    it.each(['$schema', 'appId', 'type', 'targets', 'iframe', 'minApiVersion'] as const)(
      'accepts a manifest with no %s',
      (field) => {
        const manifest = validManifest();
        delete (manifest as unknown as Record<string, unknown>)[field];
        expect(() => defineBlock({ manifest })).not.toThrow();
      },
    );

    it('accepts an empty scopes array (the canonical sets no minItems)', () => {
      expect(() => defineBlock({ manifest: validManifest({ scopes: [] }) })).not.toThrow();
    });

    it('accepts an empty targets array (the canonical sets no minItems)', () => {
      expect(() => defineBlock({ manifest: validManifest({ targets: [] }) })).not.toThrow();
    });

    it('accepts a 137-character name (the canonical imposes no length cap)', () => {
      // 137, not 81: a fixture that only just crosses the DELETED bound would
      // still pass if the bound came back one character wider.
      expect(() => defineBlock({ manifest: validManifest({ name: 'x'.repeat(137) }) })).not.toThrow();
    });

    it('accepts an iframe with no sub-fields at all', () => {
      expect(() => defineBlock({ manifest: validManifest({ iframe: {} }) })).not.toThrow();
    });

    it('accepts a target with no priority', () => {
      const manifest = validManifest({ targets: [{ slotId: 'model.sidebar_top' }] });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });
  });

  describe('rejects invalid manifests', () => {
    it('throws BlockManifestError instances', () => {
      expect(() => defineBlock({ manifest: validManifest({ blockId: 'BadId' }) })).toThrow(
        BlockManifestError,
      );
    });

    it.each([
      ['uppercase', 'BadBlock'],
      ['too short', 'ab'],
      ['spaces and punctuation', 'my block!'],
      ['leading digit', '1block'],
    ])('rejects a blockId that is %s', (_why, blockId) => {
      expectRejection(validManifest({ blockId }), 'blockId', /blockId must match/);
    });

    it('rejects non-string blockId (typeof guard, not just pattern coercion)', () => {
      expectRejection(
        validManifest({ blockId: 123 as unknown as string }),
        'blockId',
        /blockId must be a non-empty string/,
      );
    });

    it('rejects PascalCase scope with the pointed message', () => {
      expectRejection(validManifest({ scopes: ['ModelsReadSelf'] }), 'scopes', /PascalCase/);
    });

    it('rejects non-PascalCase malformed scope with the generic pattern message (no PascalCase mislabel)', () => {
      const manifest = validManifest({ scopes: ['models:read'] });
      try {
        defineBlock({ manifest });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as Error).message).not.toContain('PascalCase');
        expect((err as Error).message).toContain('three colon-separated');
      }
    });

    it('rejects a well-formed but UNKNOWN scope (membership, not just format)', () => {
      expectRejection(validManifest({ scopes: ['foo:bar:baz'] }), 'scopes', /unknown block scope/);
    });

    it.each([
      'apps:storage:read',
      'apps:storage:write',
      'apps:storage:shared:read',
      'apps:storage:shared:write',
      'collections:read:self',
      'collections:write:self',
      'collections:read:private',
      'posts:write:self',
    ])('accepts the scope %s', (scope) => {
      expect(() => defineBlock({ manifest: validManifest({ scopes: [scope] }) })).not.toThrow();
    });

    it('rejects a justification for a scope the manifest does not request', () => {
      const manifest = validManifest({
        scopes: ['models:read:self'],
        scopeJustifications: { 'buzz:read:self': 'we would like to' },
      });
      expectRejection(manifest, 'scopeJustifications.buzz:read:self', /not in manifest\.scopes/);
    });

    it('accepts a known optional category and rejects an unknown one', () => {
      expect(() => defineBlock({ manifest: validManifest({ category: 'utility' }) })).not.toThrow();
      expectRejection(
        validManifest({ category: 'nonsense' as unknown as BlockManifest['category'] }),
        'category',
        /category must be one of/,
      );
    });

    it.each([
      'allow-scripts allow-same-origin',
      'allow-scripts allow-top-navigation',
      'allow-scripts allow-top-navigation-by-user-activation',
      'allow-scripts allow-top-navigation-to-custom-protocols',
    ])('rejects sandbox %s', (sandbox) => {
      const manifest = validManifest({ iframe: { ...validManifest().iframe, sandbox } });
      expectRejection(manifest, 'iframe.sandbox', /must not contain/);
    });

    it('tokenizes sandbox on any whitespace (tabs, newlines) when rejecting', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, sandbox: 'allow-scripts\tallow-same-origin\nallow-forms' },
      });
      expectRejection(manifest, 'iframe.sandbox', /allow-same-origin/);
    });

    it('rejects an unknown iframe key (the canonical sets additionalProperties: false)', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, loading: 'lazy' } as never,
      });
      expectRejection(manifest, 'iframe.loading', /not a known iframe property/);
    });

    it('rejects iframe non-object', () => {
      expectRejection(
        validManifest({ iframe: 'oops' as unknown as BlockManifest['iframe'] }),
        'iframe',
        /iframe must be an object/,
      );
    });

    it('rejects iframe.sandbox non-string', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, sandbox: ['allow-scripts'] as unknown as string },
      });
      expectRejection(manifest, 'iframe.sandbox', /sandbox must be a non-empty string/);
    });

    it.each([200.5, Number.NaN, Number.POSITIVE_INFINITY, 'nope'])(
      'rejects non-integer iframe.minHeight %s',
      (minHeight) => {
        const manifest = validManifest({
          iframe: { ...validManifest().iframe, minHeight: minHeight as number },
        });
        expectRejection(manifest, 'iframe.minHeight', /must be an integer/);
      },
    );

    it.each([0, -1, 39, 4001])('rejects out-of-range iframe.minHeight %s', (minHeight) => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, minHeight },
      });
      expectRejection(manifest, 'iframe.minHeight', /must be between 40 and 4000 px/);
    });

    it.each([39, 4001])('rejects out-of-range iframe.maxHeight %s', (maxHeight) => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, maxHeight },
      });
      expectRejection(manifest, 'iframe.maxHeight', /must be between 40 and 4000 px/);
    });

    it('accepts iframe.maxHeight omitted or null', () => {
      const base = validManifest();
      const { maxHeight: _ignored, ...iframeWithoutMaxHeight } = base.iframe ?? {};
      expect(() =>
        defineBlock({ manifest: { ...base, iframe: iframeWithoutMaxHeight } as BlockManifest }),
      ).not.toThrow();
      expect(() =>
        defineBlock({ manifest: validManifest({ iframe: { ...base.iframe, maxHeight: null } }) }),
      ).not.toThrow();
    });

    it('rejects iframe.resizable non-boolean', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, resizable: 'yes' as unknown as boolean },
      });
      expectRejection(manifest, 'iframe.resizable', /resizable must be a boolean/);
    });

    it('rejects empty name', () => {
      expectRejection(validManifest({ name: '' }), 'name', /name must be a non-empty string/);
    });

    it('rejects empty appId when the key is present (tolerated, never required)', () => {
      expectRejection(validManifest({ appId: '' }), 'appId', /appId must be a non-empty string/);
    });

    it('rejects non-semver version and accepts a prerelease', () => {
      expectRejection(validManifest({ version: 'not-semver' }), 'version', /version must be semver/);
      expect(() => defineBlock({ manifest: validManifest({ version: '1.2.3-beta.1' }) })).not.toThrow();
    });

    it('rejects unknown contentRating', () => {
      expectRejection(
        validManifest({ contentRating: 'mature' as unknown as BlockManifest['contentRating'] }),
        'contentRating',
        /contentRating must be one of/,
      );
    });

    it.each(['widget', 'embed'])('rejects manifest.type %s (the canonical enum is ["block"])', (type) => {
      // `embed` is the one the old validator wrongly ACCEPTED, and the one the
      // old parity test never tried.
      expectRejection(
        validManifest({ type: type as unknown as BlockManifest['type'] }),
        'type',
        /type must be "block"/,
      );
    });

    it('rejects more than 16 targets', () => {
      const manifest = validManifest({
        targets: Array.from({ length: 17 }, (_, i) => ({ slotId: `slot.${i}` })),
      });
      expectRejection(manifest, 'targets', /at most 16 entries/);
    });

    it('rejects target with empty slotId', () => {
      expectRejection(
        validManifest({ targets: [{ slotId: '', priority: 100 }] }),
        'targets[0].slotId',
        /slotId must be a non-empty string/,
      );
    });

    it('rejects target with non-integer priority', () => {
      expectRejection(
        validManifest({ targets: [{ slotId: 'slot.a', priority: 1.5 }] }),
        'targets[0].priority',
        /priority must be an integer/,
      );
    });

    it('rejects minApiVersion that is not dot-separated integers', () => {
      expectRejection(
        validManifest({ minApiVersion: '1.0.x' }),
        'minApiVersion',
        /dot-separated integers/,
      );
    });

    it('rejects a buildCommand outside the allowlist', () => {
      expectRejection(
        validManifest({ buildCommand: 'rm -rf /', outputDir: 'dist' }),
        'buildCommand',
        /allowlisted build invocations/,
      );
    });

    it('rejects buildCommand without outputDir (the canonical allOf)', () => {
      expectRejection(
        validManifest({ buildCommand: 'pnpm run build' }),
        'outputDir',
        /required when manifest\.buildCommand is set/,
      );
    });

    it.each([
      ['a traversal segment', '../escape', /path-traversal/],
      ['an absolute path', '/srv/dist', /must be relative/],
      ['a backslash', 'dist\\out', /backslash/],
      ['a Windows drive prefix', 'C:/dist', /Windows drive prefix/],
    ] as const)('rejects an outputDir with %s', (_why, outputDir, message) => {
      expectRejection(validManifest({ outputDir }), 'outputDir', message);
    });

    it('rejects a repository that is not a root URL on an allowed host', () => {
      expectRejection(
        validManifest({ repository: 'https://github.com/owner/repo/tree/main' }),
        'repository',
        /repository ROOT/,
      );
    });

    it('rejects a non-https assetBundleUrl', () => {
      expectRejection(
        validManifest({ assetBundleUrl: 'http://cdn.example.com/b.zip' }),
        'assetBundleUrl',
        /public https:\/\/ URL/,
      );
    });

    it('rejects an unknown renderMode', () => {
      expectRejection(
        validManifest({ renderMode: 'popover' as never }),
        'renderMode',
        /renderMode must be one of/,
      );
    });

    it('rejects a non-boolean bootSkeleton', () => {
      expectRejection(
        validManifest({ bootSkeleton: 'yes' as never }),
        'bootSkeleton',
        /bootSkeleton must be a boolean/,
      );
    });

    it('rejects a page with no title', () => {
      expectRejection(
        validManifest({ page: { path: '/board' } as never }),
        'page.title',
        /page\.title must be a non-empty string/,
      );
    });

    it('rejects a page path with no leading slash', () => {
      expectRejection(
        validManifest({ page: { path: 'board', title: 'Board' } }),
        'page.path',
        /must start with "\/"/,
      );
    });

    it('rejects a non-positive page.buzzBudgetPerGen', () => {
      expectRejection(
        validManifest({ page: { path: '/board', title: 'Board', buzzBudgetPerGen: 0 } }),
        'page.buzzBudgetPerGen',
        /positive integer/,
      );
    });

    it('rejects more than 32 publicSettingsKeys', () => {
      expectRejection(
        validManifest({ publicSettingsKeys: Array.from({ length: 33 }, (_, i) => `k${i}`) }),
        'publicSettingsKeys',
        /at most 32 entries/,
      );
    });

    it('rejects asset with non-SRI integrity', () => {
      expectRejection(
        validManifest({
          assets: [{ url: 'https://cdn.example.com/a.js', integrity: 'md5-deadbeef' }],
        }),
        'assets[0].integrity',
        /SubresourceIntegrity hash/,
      );
    });

    it('rejects setting with unknown type', () => {
      expectRejection(
        validManifest({
          settings: { x: { scope: 'publisher', type: 'date', label: 'X', description: 'D' } } as never,
        }),
        'settings.x.type',
        /type must be one of number, string, boolean/,
      );
    });

    it('rejects settings as an array (old v0-pre shape)', () => {
      expectRejection(
        validManifest({ settings: [{ id: 'x', type: 'number', label: 'X' }] as never }),
        'settings',
        /settings must be an object/,
      );
    });

    it('rejects setting key in non-snake_case', () => {
      expectRejection(
        validManifest({
          settings: {
            BadKey: { scope: 'publisher', type: 'boolean', label: 'L', description: 'D' },
          } as never,
        }),
        'settings.BadKey',
        /snake_case/,
      );
    });

    it('rejects setting with missing scope', () => {
      expectRejection(
        validManifest({ settings: { x: { type: 'boolean', label: 'L', description: 'D' } } as never }),
        'settings.x.scope',
        /scope must be one of publisher, viewer/,
      );
    });

    it('rejects wrong $schema URL (but omission is fine)', () => {
      expectRejection(
        validManifest({ $schema: 'https://example.com/wrong.json' as BlockManifest['$schema'] }),
        '$schema',
        /\$schema must be/,
      );
    });

    it.each(['blockId', 'version', 'name', 'contentRating', 'scopes'] as const)(
      'rejects when canonical-required field %s is missing',
      (field) => {
        const manifest = validManifest();
        delete (manifest as unknown as Record<string, unknown>)[field];
        expectRejection(manifest, field, new RegExp(`manifest\\.${field} is required`));
      },
    );
  });
});
