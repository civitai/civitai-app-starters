/**
 * Build-time validation for a `block.manifest.json`, DERIVED FROM THE CANONICAL
 * SCHEMA rather than hand-mirrored.
 *
 * WHY IT IS SHAPED THIS WAY. #330's proposed fix, item 1, verbatim: "Derive the
 * rules from the schema, not by hand. […] A hand-written mirror of an external
 * schema regenerates this bug every time the schema moves." The previous
 * implementation was that hand-written mirror — 11 required fields against the
 * canonical's 5, `appId` required though the canonical does not declare it, and
 * `iframe.src` required though the platform REFUSES it. It rejected all seven
 * `block.manifest.json` files this repo ships.
 *
 * So the machine-checkable rules are not written down here at all. They are
 * read from `schemas/app-block/v1.json` — a byte-identical vendored copy of
 * https://civitai.com/schemas/app-block/v1.json, kept in lockstep by
 * `scripts/check-canonical-schema.sh` (CI job `schema-drift`) — and compiled
 * with Ajv. Every `required`, `enum`, `pattern`, bound, `additionalProperties`
 * and `allOf` in the canonical is therefore enforced here for free, and moves
 * when the canonical moves.
 *
 * WHY THIS SUBPATH IS NODE-ONLY. Reading the schema needs `node:fs`, and Ajv is
 * a runtime dependency. `@civitai/app-sdk`'s `dependencies` are empty on purpose
 * — it ships into sandboxed browser iframes and every app inherits its install
 * graph — so Ajv is an OPTIONAL PEER (the `@civitai/client` precedent) consumed
 * only from `@civitai/app-sdk/manifest` and `@civitai/app-sdk/vite`. The only
 * real caller is the Vite plugin, which runs in Node at build time. The
 * browser-facing `./blocks` subpath keeps zero runtime dependencies.
 *
 * THE CLAIM YOU CAN CHECK:
 *
 *   1. `defineBlock` REJECTS everything the canonical schema rejects. This holds
 *      BY CONSTRUCTION, not by a fixture corpus: Ajv runs first and any error it
 *      reports is thrown. There is no relaxation carve-out anywhere below.
 *   2. Beyond that it rejects exactly the rules in {@link SCHEMA_DIVERGENCES} —
 *      each one a server rejection the canonical states only in PROSE, each
 *      carrying the prose it mirrors.
 *   3. Nothing else.
 *
 * PASSING IS NECESSARY, NOT SUFFICIENT for `civitai app submit` — see
 * {@link KNOWN_GAPS}. And it is not a replacement for `civitai app validate`,
 * the Go CLI's own local pre-check; this exists so a mistake surfaces during
 * `pnpm dev` / `pnpm build` rather than at submit time.
 */

import { readFileSync } from 'node:fs';

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import { BlockManifestError } from '../blocks/manifestError.js';
import { BLOCK_SCOPES } from '../blocks/scopes.js';
import type { BlockManifest } from '../blocks/types.js';

/**
 * Rules `defineBlock` applies that the canonical schema does NOT express in
 * machine-checkable form.
 *
 * EVERY ENTRY IS STRICTLY ADDITIVE — it can only ever REJECT a manifest Ajv
 * accepted. None of them relaxes a canonical rule. That is what makes claim (1)
 * in the module docblock structural rather than a promise, and it is asserted
 * per-entry by `test/manifest/divergences.test.ts`: each entry must name a
 * fixture the canonical schema ACCEPTS and `defineBlock` REJECTS on that
 * entry's own field path. An entry with no such fixture fails the suite.
 *
 * Each `canonical` field quotes the schema text the rule mirrors, so the next
 * person can check the mirror against its source without leaving this file.
 */
export const SCHEMA_DIVERGENCES = {
  'iframe.src': {
    rule: 'REJECTED when present.',
    canonical:
      'Declared under `iframe.properties` with the description "SERVER-OWNED. Do NOT set ' +
      "iframe.src — the platform assigns it. Present here only so the schema can reject dev-set " +
      'values." The JSON-Schema `not` is deliberately absent; the top-level `allOf` $comment says ' +
      'the platform validator and the Go CLI reject it "with clearer error messages than JSON ' +
      "Schema's `not`\".",
    reason:
      'Mirrors a server rejection the canonical states in prose and deliberately does not encode. ' +
      'This is the #330 headline inverted: the old validator REQUIRED `iframe.src`, demanding the ' +
      'exact value submit refuses.',
  },
  trustTier: {
    rule: 'REJECTED when present.',
    canonical:
      'Declared with the description "SERVER-OWNED. Do NOT set this in your manifest — the ' +
      'platform assigns the trust tier during review. Present here only to reject dev-set values." ' +
      'Same deliberately-absent `not` as `iframe.src`, per the same `allOf` $comment.',
    reason: 'Mirrors a server rejection the canonical states in prose.',
  },
  'iframe.sandbox': {
    rule: 'Rejects `allow-same-origin` and every `allow-top-navigation*` token.',
    canonical:
      'Only `minLength: 1`. The description carries two separate prose rules: a TIER ALLOWLIST ' +
      '("Unverified tier allows only: allow-scripts, allow-forms") and a flat prohibition ' +
      '("Never combine allow-same-origin with allow-scripts").',
    reason:
      'Mirrors the flat prohibition, plus top-navigation (including the -by-user-activation and ' +
      '-to-custom-protocols variants), which lets a block navigate the host frame instead of ' +
      'routing through the NAVIGATE postMessage. ' +
      '🔴 THE TIER ALLOWLIST IS DELIBERATELY NOT MIRRORED, AND THAT MAKES THIS GATE LOOSER THAN ' +
      'REVIEW IN THE OTHER DIRECTION: `allow-popups`, `allow-modals`, `allow-downloads` and any ' +
      'other token outside {allow-scripts, allow-forms} PASS HERE and may be refused at review. ' +
      'They are not rejected because the tier is assigned server-side during review and is ' +
      'unknowable locally — `starters/civitai-block-starter` itself ships ' +
      '"allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox". See ' +
      'KNOWN_GAPS["tier-dependent-sandbox-allowlist"].',
  },
  scopeJustifications: {
    rule: 'Every key must name a scope also present in `scopes`.',
    canonical:
      '`additionalProperties: { type: string, minLength: 1, maxLength: 500 }` — any key passes. ' +
      'The canonical says so itself: "The requirement is enforced imperatively by the manifest ' +
      'validator (not expressed as JSON-Schema conditionals here)."',
    reason:
      'Mirrors a server rejection the canonical states in prose. The OTHER half of that server ' +
      'rule — justifications being REQUIRED for sensitive scopes — is NOT mirrored; see ' +
      'KNOWN_GAPS["scopeJustifications-required-for-sensitive-scopes"].',
  },
  settings: {
    rule: 'Validated against the W3 settings meta-schema (scope/type/label/description, snake_case keys, max 32).',
    canonical: 'Not a declared property. The canonical top level is not `additionalProperties: false`, so it passes.',
    reason:
      "Manifest settings ARE validated server-side, by civitai/civitai's " +
      '`manifest-settings.meta.schema.ts` rather than by the app-block schema, and two of the ' +
      'seven shipped manifests declare `settings`. ' +
      '🔴 THIS IS THE ONE REMAINING HAND-WRITTEN MIRROR OF AN EXTERNAL SCHEMA IN THIS FILE, i.e. ' +
      'exactly the construct #330 was filed about — it is here only because that meta-schema is ' +
      'NOT published at a URL and NOT vendored, so there is nothing to derive from. The fix is ' +
      'upstream: publish it and vendor it beside `app-block/v1.json` with the same drift-check, ' +
      'then delete this. See KNOWN_GAPS["settings-meta-schema-not-vendored"].',
  },
} as const;

/**
 * Rules the server applies that `defineBlock` deliberately does NOT — stated so
 * nobody reads a green `defineBlock` as "submit will succeed". Run
 * `civitai app validate` (the Go CLI) before `civitai app submit`; it checks
 * against the same canonical and knows things this cannot.
 */
export const KNOWN_GAPS = {
  'scopeJustifications-required-for-sensitive-scopes':
    'The canonical names the sensitive scope set only in a prose description, not in a ' +
    'machine-readable form. Hand-mirroring that list would regenerate the #330 drift bug, so ' +
    'only the SHAPE is checked here (keys must be declared scopes; the canonical checks the ' +
    '1..500-char values). The requirement itself is server-side.',
  'repository-per-segment-rules':
    'The canonical\'s `repository` pattern is documented as "a coarse SHAPE check and NOT the ' +
    'whole rule"; the server additionally constrains each path segment. Ajv enforces the ' +
    'canonical pattern exactly, and is therefore necessary-not-sufficient BY THE CANONICAL\'S ' +
    'OWN DESIGN.',
  'tier-dependent-sandbox-allowlist':
    'The canonical\'s sandbox description is an ALLOWLIST ("Unverified tier allows only: ' +
    'allow-scripts, allow-forms"), but the tier is assigned server-side during review, so the ' +
    'applicable allowlist is unknowable at build time. Tokens outside that set pass here and may ' +
    'be refused at review. See SCHEMA_DIVERGENCES["iframe.sandbox"].',
  'review-granted-scope-subset':
    'Which of the requested `scopes` review actually grants has no schema expression at all.',
  'slotId-registry':
    'Whether a `targets[].slotId` names a slot the host has registered has no schema expression; ' +
    'the canonical only requires a non-empty string.',
  'settings-meta-schema-not-vendored':
    "civitai/civitai's `manifest-settings.meta.schema.ts` is not published at a URL and not " +
    'vendored here, so `settings` is the one surface still checked by a hand-written mirror. ' +
    'See SCHEMA_DIVERGENCES.settings.',
  'format-uri-not-enforced':
    '`assetBundleUrl` carries `format: "uri"` in addition to `pattern: "^https://"`. Ajv ignores ' +
    'unknown formats unless `ajv-formats` is installed, which would be a second optional peer for ' +
    'one field whose pattern is already enforced. The pattern IS enforced; the `uri` format is ' +
    'not, so a value like "https://" passes here.',
} as const;

/**
 * The vendored canonical, resolved relative to THIS module so the same
 * specifier works from `src/` (vitest) and from `dist/` (published):
 * `src/manifest/` -> `../../schemas/`, `dist/manifest/` -> `../../schemas/`.
 * `schemas` is in package.json `files`, so it ships.
 */
const CANONICAL_SCHEMA_PATH = new URL('../../schemas/app-block/v1.json', import.meta.url);

/** The canonical schema object, parsed once. Exported for tests and tooling. */
export function loadCanonicalSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(CANONICAL_SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
}

let compiled: ValidateFunction | undefined;

function canonicalValidator(): ValidateFunction {
  if (compiled) return compiled;
  // `strict: false` because the canonical uses `$comment` and a `format` Ajv
  // does not know (see KNOWN_GAPS['format-uri-not-enforced']); strict mode would
  // turn those into compile-time throws over a schema this package does not own
  // and must not edit.
  //
  // `logger: false` because that same unknown format makes Ajv log
  // `unknown format "uri" ignored…` to the console AT COMPILE TIME — which, via
  // the Vite plugin, would print on every `pnpm dev` and `pnpm build` in every
  // scaffold. The gap is recorded in KNOWN_GAPS, not shouted at the author on
  // every boot. NOTE this silences Ajv's own diagnostics only; validation
  // errors are returned in `validate.errors`, never logged.
  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
  compiled = ajv.compile(loadCanonicalSchema());
  return compiled;
}

/** `/iframe/minHeight` -> `iframe.minHeight`; `/targets/0/slotId` -> `targets[0].slotId`. */
function toDotPath(instancePath: string): string {
  if (instancePath === '') return '';
  return instancePath
    .slice(1)
    .split('/')
    .reduce((acc, segment) => {
      // JSON Pointer escapes: ~1 is '/', ~0 is '~'.
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (/^\d+$/.test(key)) return `${acc}[${key}]`;
      return acc === '' ? key : `${acc}.${key}`;
    }, '');
}

const PASCAL_CASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Turns the FIRST Ajv error into a `BlockManifestError`. Ajv's own wording is
 * kept (it is derived from the schema, so it cannot drift); only the field path
 * is reshaped, and one case gets an extra hint because it is the mistake the
 * docs see most.
 */
function toManifestError(error: ErrorObject, manifest: unknown): BlockManifestError {
  const base = toDotPath(error.instancePath);
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty: string }).missingProperty;
    const field = base === '' ? missing : `${base}.${missing}`;
    return new BlockManifestError(`manifest.${field} is required`, field);
  }

  const field = base;
  const shown = field === '' ? 'manifest' : `manifest.${field}`;
  let message = `${shown} ${error.message ?? 'is invalid'}`;

  if (error.keyword === 'enum') {
    const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues;
    if (allowed) message += ` (${allowed.map((v) => JSON.stringify(v)).join(', ')})`;
  }
  if (error.keyword === 'additionalProperties') {
    const extra = (error.params as { additionalProperty: string }).additionalProperty;
    message = `${shown}.${extra} is not a known property here`;
    return new BlockManifestError(message, field === '' ? extra : `${field}.${extra}`);
  }

  // The one hint worth adding: block scopes are colon-separated lowercase, and
  // the OAuth scopes elsewhere in this SDK are PascalCase bitmask names, so
  // authors reach for the wrong spelling.
  if (/^scopes\[\d+\]$/.test(field)) {
    const index = Number(field.slice(field.indexOf('[') + 1, -1));
    const value = (manifest as { scopes?: unknown[] } | undefined)?.scopes?.[index];
    if (typeof value === 'string' && PASCAL_CASE_PATTERN.test(value)) {
      message +=
        '. Block scope strings are colon-separated lowercase (e.g. "models:read:self"), ' +
        'not the PascalCase OAuth bitmask names';
    }
    message += `. Must be one of: ${Object.values(BLOCK_SCOPES).join(', ')}`;
  }

  return new BlockManifestError(message, field);
}

export interface DefineBlockConfig {
  manifest: BlockManifest;
  // v2 will add an optional `render` callback for inline-mode hosts. It is
  // intentionally absent here so the SDK stays free of DOM-typed surface
  // until the inline runtime ships.
}

/**
 * Validates the manifest against the canonical schema and returns it unchanged.
 * Acts as a typed identity function — call it from the build (see
 * `@civitai/app-sdk/vite`) so violations throw before anything ships. Throws
 * {@link BlockManifestError} (with a `.field` dot-path).
 *
 * Enforces every rule the canonical `block.manifest.json` schema expresses,
 * plus the prose-only server rejections in {@link SCHEMA_DIVERGENCES}. See
 * {@link KNOWN_GAPS} for what only the server can check.
 *
 * The example below is kept byte-identical to `test/manifest/defineBlock.example.ts`,
 * which is compiled and executed by the suite — a guard fails if they drift, so
 * this snippet both type-checks and runs.
 *
 * @example
 * import { defineBlock } from '@civitai/app-sdk/manifest';
 *
 * export const manifest = defineBlock({
 *   manifest: {
 *     $schema: 'https://civitai.com/schemas/app-block/v1.json',
 *     blockId: 'my-block',
 *     version: '0.1.0',
 *     name: 'My Block',
 *     type: 'block',
 *     targets: [{ slotId: 'model.sidebar_top', priority: 100 }],
 *     scopes: ['models:read:self'],
 *     // NOTE: no `iframe.src` — the platform stamps it at build/approve time.
 *     iframe: {
 *       minHeight: 200,
 *       maxHeight: 600,
 *       resizable: true,
 *       sandbox: 'allow-scripts allow-forms',
 *     },
 *     contentRating: 'pg',
 *     minApiVersion: '1.0',
 *   },
 * });
 */
export function defineBlock(config: DefineBlockConfig): BlockManifest {
  const { manifest } = config;

  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new BlockManifestError('manifest must be an object');
  }

  // (1) Everything the canonical expresses. No carve-outs, no suppression:
  // whatever Ajv rejects, this rejects.
  const validate = canonicalValidator();
  if (!validate(manifest)) {
    const errors = validate.errors ?? [];
    const first = errors[0];
    /* c8 ignore next */
    if (!first) throw new BlockManifestError('manifest failed schema validation');
    throw toManifestError(first, manifest);
  }

  // (2) The prose-only server rejections. Strictly additive, one per
  // SCHEMA_DIVERGENCES entry, in the table's order.
  rejectServerOwned(manifest);
  rejectDangerousSandboxTokens(manifest);
  rejectUndeclaredScopeJustifications(manifest);
  if (manifest.settings !== undefined) validateSettings(manifest.settings);

  return manifest;
}

const SERVER_OWNED_MESSAGE =
  'is SERVER-OWNED — the platform assigns it during build/approve. Remove it from the manifest.';

/** SCHEMA_DIVERGENCES['iframe.src'] and SCHEMA_DIVERGENCES.trustTier. */
function rejectServerOwned(manifest: BlockManifest): void {
  if ((manifest as { trustTier?: unknown }).trustTier !== undefined) {
    throw new BlockManifestError(`manifest.trustTier ${SERVER_OWNED_MESSAGE}`, 'trustTier');
  }
  const iframe = manifest.iframe as { src?: unknown } | undefined;
  if (iframe != null && iframe.src !== undefined) {
    throw new BlockManifestError(`manifest.iframe.src ${SERVER_OWNED_MESSAGE}`, 'iframe.src');
  }
}

/**
 * SCHEMA_DIVERGENCES['iframe.sandbox']. A DENYLIST, not the canonical's tier
 * allowlist — see that entry and KNOWN_GAPS['tier-dependent-sandbox-allowlist']
 * for why, and for what therefore passes here and fails at review.
 */
const BANNED_SANDBOX_TOKENS = new Set([
  'allow-same-origin',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

function rejectDangerousSandboxTokens(manifest: BlockManifest): void {
  const sandbox = manifest.iframe?.sandbox;
  if (typeof sandbox !== 'string') return;
  const tokens = new Set(sandbox.split(/\s+/).filter(Boolean));
  for (const banned of BANNED_SANDBOX_TOKENS) {
    if (tokens.has(banned)) {
      throw new BlockManifestError(
        `manifest.iframe.sandbox must not contain "${banned}". ` +
          (banned === 'allow-same-origin'
            ? 'Combined with "allow-scripts" it defeats the sandbox entirely.'
            : 'Blocks must route navigation through the NAVIGATE postMessage so the host can mediate.'),
        'iframe.sandbox',
      );
    }
  }
}

/** SCHEMA_DIVERGENCES.scopeJustifications. */
function rejectUndeclaredScopeJustifications(manifest: BlockManifest): void {
  const justifications = manifest.scopeJustifications;
  if (justifications == null) return;
  const declared = new Set<string>(manifest.scopes ?? []);
  for (const scope of Object.keys(justifications)) {
    if (!declared.has(scope)) {
      const path = `scopeJustifications.${scope}`;
      throw new BlockManifestError(
        `manifest.${path} justifies a scope that is not in manifest.scopes. ` +
          'Every justification key must be a scope the manifest actually requests.',
        path,
      );
    }
  }
}

/**
 * SCHEMA_DIVERGENCES.settings — the one hand-written mirror left, of
 * civitai/civitai's `manifest-settings.meta.schema.ts`. Keep both sides aligned
 * until that meta-schema is published and vendored; see
 * KNOWN_GAPS['settings-meta-schema-not-vendored'].
 */
const SETTING_TYPES = ['number', 'string', 'boolean'] as const;
const SETTING_SCOPES = ['publisher', 'viewer'] as const;
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const MAX_SETTINGS_PER_BLOCK = 32;
type SettingType = (typeof SETTING_TYPES)[number];
type SettingScope = (typeof SETTING_SCOPES)[number];

function validateSettings(settings: BlockManifest['settings']): void {
  if (settings == null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new BlockManifestError(
      'manifest.settings must be an object (record keyed by snake_case field name)',
      'settings',
    );
  }
  const entries = Object.entries(settings as Record<string, unknown>);
  if (entries.length > MAX_SETTINGS_PER_BLOCK) {
    throw new BlockManifestError(
      `manifest.settings has ${entries.length} entries (max ${MAX_SETTINGS_PER_BLOCK})`,
      'settings',
    );
  }
  for (const [key, raw] of entries) {
    const path = `settings.${key}`;
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new BlockManifestError(
        `manifest.${path}: key must match ${SETTING_KEY_PATTERN} (snake_case, must start with a letter)`,
        path,
      );
    }
    if (raw == null || typeof raw !== 'object') {
      throw new BlockManifestError(`manifest.${path} must be an object`, path);
    }
    const s = raw as {
      scope?: unknown;
      type?: unknown;
      label?: unknown;
      description?: unknown;
    };
    if (typeof s.scope !== 'string' || !SETTING_SCOPES.includes(s.scope as SettingScope)) {
      throw new BlockManifestError(
        `manifest.${path}.scope must be one of ${SETTING_SCOPES.join(', ')}. Got: ${JSON.stringify(s.scope)}`,
        `${path}.scope`,
      );
    }
    if (typeof s.type !== 'string' || !SETTING_TYPES.includes(s.type as SettingType)) {
      throw new BlockManifestError(
        `manifest.${path}.type must be one of ${SETTING_TYPES.join(', ')}. Got: ${JSON.stringify(s.type)}`,
        `${path}.type`,
      );
    }
    if (typeof s.label !== 'string' || s.label.length === 0) {
      throw new BlockManifestError(
        `manifest.${path}.label must be a non-empty string`,
        `${path}.label`,
      );
    }
    if (typeof s.description !== 'string' || s.description.length === 0) {
      throw new BlockManifestError(
        `manifest.${path}.description must be a non-empty string`,
        `${path}.description`,
      );
    }
  }
}
