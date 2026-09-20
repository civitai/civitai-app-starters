/**
 * Build-time / startup validation for a `BlockManifestV1`.
 *
 * WHAT THIS IS, PRECISELY. The old docblock claimed "a strict subset of what
 * the civitai/civitai server enforces". That was false in both directions — it
 * required 11 fields where the canonical requires 5 (including `appId`, which
 * the canonical does not declare at all) and it rejected every
 * `block.manifest.json` this repo ships. It is gone (issue #330). What replaces
 * it is a claim you can actually check:
 *
 *   1. Every rule the CANONICAL schema expresses in machine-checkable form is
 *      enforced here. "Canonical" = `schemas/app-block/v1.json`, a
 *      byte-identical vendored copy of
 *      https://civitai.com/schemas/app-block/v1.json, kept in lockstep by
 *      `scripts/check-canonical-schema.sh` (CI job `schema-drift`).
 *   2. Beyond that, exactly the rules in {@link SCHEMA_DIVERGENCES} — each one
 *      mirroring a server check the canonical states only in PROSE, each
 *      carrying its own reason.
 *   3. Nothing else. `defineBlock` never requires a field the canonical does
 *      not require, and never applies a bound the canonical does not apply.
 *
 * Both halves are MECHANICALLY checked, not asserted in prose:
 * `test/blocks/schema-parity.test.ts` runs Ajv against the vendored schema over
 * a fixture corpus and asserts `defineBlock`'s verdict agrees with the schema's
 * on every fixture except the ones the divergence table names.
 *
 * PASSING IS NECESSARY, NOT SUFFICIENT, for `civitai app submit` — see
 * {@link KNOWN_GAPS}. Do not read a green `defineBlock` as "submit will
 * succeed".
 *
 * Every check guards `typeof` before pattern-testing — the highest-value
 * caller is `JSON.parse(fs.readFileSync('block.manifest.json'))`, where
 * the TypeScript type is a lie.
 */

import {
  BLOCK_CATEGORIES,
  BLOCK_SCOPES,
  BLOCK_SCOPE_PATTERN,
  BLOCK_TAGLINE_MAX_LENGTH,
} from './scopes.js';
import type { BlockManifest, ContentRating } from './types.js';

/**
 * Rules `defineBlock` applies that the canonical schema does NOT express in
 * machine-checkable form. Every entry is a decision with a reason; there is no
 * blanket "we are stricter" clause. `schema-parity.test.ts` asserts this table
 * covers the divergences that actually exist — adding a rule without an entry
 * here fails the suite.
 *
 * Not exported from `./index.ts` on purpose: this is documentation plus a test
 * oracle, not public API.
 */
export const SCHEMA_DIVERGENCES = {
  '$schema': {
    rule: 'When present, must equal the canonical schema URL exactly.',
    canonical: 'Any string; the description says it is "ignored by the platform validator".',
    reason:
      'The ONLY thing `$schema` does is point an editor at the canonical for live validation. ' +
      'A wrong URL silently turns that off, which is indistinguishable from having no editor ' +
      'validation at all. Never REQUIRED — omitting it is fine.',
  },
  appId: {
    rule: 'When present, must be a non-empty string. Never required.',
    canonical: 'Not a declared property. The top level does not forbid extra keys, so it is tolerated.',
    reason:
      '`appId` is APP-level config and lives in `civitai.app.json`, not in the block manifest. ' +
      'It was REQUIRED here until #330 — that was the headline defect. It is now tolerated (the ' +
      'starters still carry it) and shape-checked only; a non-string can only be a mistake, and ' +
      'the check cannot reject a manifest the server accepts.',
  },
  'targets[].priority': {
    rule: 'When present, must be an integer.',
    canonical: 'Not a declared property of a target item (only `slotId` is).',
    reason:
      'Universally present in authored manifests and in the docs. Shape-checked when present, ' +
      'never required — a non-integer can only be an authoring mistake.',
  },
  'iframe.src': {
    rule: 'REJECTED when present.',
    canonical:
      'Declared under `iframe.properties` with the description "SERVER-OWNED. Do NOT set ' +
      "iframe.src — the platform assigns it. Present here only so the schema can reject dev-set " +
      'values." The JSON-Schema `not` is deliberately absent; the top-level `allOf` $comment ' +
      'says the platform validator and the Go CLI reject it "with clearer error messages".',
    reason:
      'Mirrors the server check the canonical states in prose. This one is load-bearing in the ' +
      'opposite direction from every other entry: before #330 `defineBlock` REQUIRED `iframe.src`, ' +
      'so it demanded the exact value submit refuses.',
  },
  trustTier: {
    rule: 'REJECTED when present.',
    canonical:
      'Declared with the description "SERVER-OWNED. Do NOT set this in your manifest — the ' +
      'platform assigns the trust tier during review. Present here only to reject dev-set values." ' +
      'Same missing-`not` situation as `iframe.src`.',
    reason: 'Mirrors the server check the canonical states in prose.',
  },
  'iframe.sandbox': {
    rule: 'Rejects allow-same-origin and every allow-top-navigation* token.',
    canonical: 'Only `minLength: 1`; the tier allowlist is prose in the description.',
    reason:
      'allow-same-origin combined with allow-scripts defeats the sandbox entirely, and ' +
      'top-navigation (including the -by-user-activation and -to-custom-protocols variants) lets ' +
      'the block navigate the host frame instead of routing through the NAVIGATE postMessage. ' +
      'Both are refused at review; catching them locally is the whole point of a client gate.',
  },
  scopeJustifications: {
    rule: 'Every key must be a scope also present in `scopes`.',
    canonical:
      '`additionalProperties: { type: string, minLength: 1, maxLength: 500 }` — any key passes. ' +
      'The canonical says so itself: "The requirement is enforced imperatively by the manifest ' +
      'validator (not expressed as JSON-Schema conditionals here)."',
    reason:
      'Mirrors the server check the canonical states in prose. The OTHER half of that server rule ' +
      '— justifications being REQUIRED for sensitive scopes — is deliberately NOT mirrored; see ' +
      'KNOWN_GAPS.',
  },
  tagline: {
    rule: 'Length is measured on the TRIMMED string.',
    canonical: '`maxLength: 140` counts the RAW string.',
    reason:
      'The server trims before measuring, and the canonical says so itself ("the server measures ' +
      'the TRIMMED length, while this maxLength counts the raw string — that asymmetry is ' +
      'deliberate"). Matching the SERVER here means a padded-but-fitting tagline is never rejected ' +
      'locally and then accepted at submit.',
  },
  assets: {
    rule: 'When present, must be an array of `{ url, integrity }` with an SRI hash.',
    canonical: 'Not a declared property (the canonical has `assetBundleUrl`, a different field).',
    reason:
      'Forward-compat surface predating `assetBundleUrl`. Shape-checked when present, never ' +
      'required — same disposition as `appId`.',
  },
  settings: {
    rule: 'Validated against the W3 settings meta-schema (scope/type/label/description, snake_case keys, max 32).',
    canonical: 'Not a declared property.',
    reason:
      "Manifest settings ARE validated server-side, by civitai/civitai's " +
      '`manifest-settings.meta.schema.ts` rather than by the app-block schema. This mirrors that ' +
      'meta-schema. `publicSettingsKeys` (which IS canonical) is validated separately.',
  },
} as const;

/**
 * Rules the server applies that `defineBlock` deliberately does NOT — stated so
 * nobody reads a green `defineBlock` as "submit will succeed".
 *
 * - `scopeJustifications` REQUIRED for sensitive scopes. The canonical names
 *   the sensitive set only in a prose description, not in a machine-readable
 *   form. Hand-mirroring that list here would regenerate exactly the drift bug
 *   #330 is about, so only the SHAPE is checked (keys must be declared scopes,
 *   values 1..500 chars); the requirement itself is server-side.
 * - `repository`. The canonical's `pattern` is documented as "a coarse SHAPE
 *   check and NOT the whole rule"; the server additionally constrains each path
 *   segment. `defineBlock` mirrors the canonical pattern exactly and is
 *   therefore necessary-not-sufficient BY THE CANONICAL'S OWN DESIGN.
 * - Rules with no schema expression at all: the scope set review actually
 *   grants, the trust-tier-dependent sandbox allowlist, and whether a `slotId`
 *   names a registered slot.
 */
export const KNOWN_GAPS = [
  'scopeJustifications-required-for-sensitive-scopes',
  'repository-per-segment-rules',
  'review-granted-scope-subset',
  'tier-dependent-sandbox-allowlist',
  'slotId-registry',
] as const;

/**
 * Canonical `blockId` rule (https://civitai.com/schemas/app-block/v1.json):
 * lowercase, must start with a letter, end alphanumeric, hyphen-separated,
 * 3–40 chars. This is the DNS-subdomain-safe rule — the blockId becomes
 * `<blockId>.civit.ai`, so it must be a valid DNS label.
 */
const BLOCK_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const BLOCK_ID_MIN_LENGTH = 3;
const BLOCK_ID_MAX_LENGTH = 40;
/** The 13 canonical block scopes (enum the schema validates `scopes` against). */
const KNOWN_BLOCK_SCOPES = new Set<string>(Object.values(BLOCK_SCOPES));
/** The 7 canonical marketplace categories (enum the schema validates `category` against). */
const KNOWN_CATEGORIES = new Set<string>(BLOCK_CATEGORIES);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Detects the SubresourceIntegrity hash format (sha256/384/512 + base64). */
const SRI_PATTERN = /^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/;
/** Heuristic for "looks PascalCase" — used only to pick the pointed error message. */
const PASCAL_CASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const EXPECTED_SCHEMA_URL = 'https://civitai.com/schemas/app-block/v1.json';

const CONTENT_RATINGS: readonly ContentRating[] = ['g', 'pg', 'pg13', 'r', 'x'];
/** Canonical `type` enum. The canonical lists ONE member — `embed` is NOT valid. */
const MANIFEST_TYPES = ['block'] as const;
/** Canonical `renderMode` enum. */
const RENDER_MODES = ['iframe', 'inline', 'hybrid'] as const;
/** Canonical `targets.maxItems`. */
const TARGETS_MAX_ITEMS = 16;
/** Canonical `minApiVersion.pattern` — dot-separated integers. */
const MIN_API_VERSION_PATTERN = /^\d+(\.\d+)*$/;
/** Canonical `iframe.minHeight` / `iframe.maxHeight` bounds. */
const IFRAME_HEIGHT_MIN = 40;
const IFRAME_HEIGHT_MAX = 4000;
/** Canonical `iframe` is `additionalProperties: false` — this is that key set. */
const IFRAME_KEYS = new Set(['src', 'minHeight', 'maxHeight', 'resizable', 'sandbox']);
/** Canonical `page` is `additionalProperties: false` — this is that key set. */
const PAGE_KEYS = new Set(['path', 'title', 'icon', 'buzzBudgetPerGen']);
const PAGE_PATH_MAX_LENGTH = 256;
const PAGE_TITLE_MAX_LENGTH = 128;
const PAGE_ICON_MAX_LENGTH = 128;
/** Canonical `buildCommand` pattern + cap (allowlisted build invocations). */
const BUILD_COMMAND_PATTERN = /^(?:(?:npm|pnpm|yarn) run [a-zA-Z0-9:_-]+|(?:npx )?vite build)$/;
const BUILD_COMMAND_MAX_LENGTH = 128;
const OUTPUT_DIR_MAX_LENGTH = 256;
/** Canonical `publicSettingsKeys` bounds. */
const PUBLIC_SETTINGS_KEYS_MAX_ITEMS = 32;
const PUBLIC_SETTINGS_KEY_MAX_LENGTH = 64;
/** Canonical `assetBundleUrl` pattern. */
const ASSET_BUNDLE_URL_PATTERN = /^https:\/\//;
/** Canonical `repository` pattern + cap (deliberately COARSE — see KNOWN_GAPS). */
const REPOSITORY_PATTERN = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[^/]+\/[^/]+\/?$/;
const REPOSITORY_MAX_LENGTH = 200;
/** Canonical `scopeJustifications.additionalProperties.maxLength`. */
const SCOPE_JUSTIFICATION_MAX_LENGTH = 500;
/**
 * W3 v0 — settings type set. Mirrors the meta-schema discriminated union
 * in civitai/civitai's `manifest-settings.meta.schema.ts`. Keep aligned.
 */
const SETTING_TYPES = ['number', 'string', 'boolean'] as const;
const SETTING_SCOPES = ['publisher', 'viewer'] as const;
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const MAX_SETTINGS_PER_BLOCK = 32;
type SettingType = (typeof SETTING_TYPES)[number];
type SettingScope = (typeof SETTING_SCOPES)[number];
/**
 * All `allow-top-navigation*` sandbox tokens are rejected. The
 * `-by-user-activation` and `-to-custom-protocols` variants gate on a user
 * gesture but produce the same threat (block navigates the host frame) —
 * blocks must route navigation through the `NAVIGATE` postMessage so the
 * host can mediate.
 */
const BANNED_SANDBOX_TOKENS = new Set([
  'allow-same-origin',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

/**
 * EXACTLY the canonical `required` array — no more. Asserted equal to
 * `schemas/app-block/v1.json#/required` by `schema-parity.test.ts`, so this
 * list cannot drift above the canonical again.
 */
const REQUIRED_FIELDS = [
  'blockId',
  'version',
  'name',
  'contentRating',
  'scopes',
] as const satisfies ReadonlyArray<keyof BlockManifest>;

/**
 * Fields the PLATFORM owns and assigns. Declaring one in a manifest is refused
 * at submit, so it is refused here. See `SCHEMA_DIVERGENCES['iframe.src']`.
 */
const SERVER_OWNED_MESSAGE =
  'is SERVER-OWNED — the platform assigns it during build/approve. Remove it from the manifest.';

/** Thrown by `defineBlock` for any manifest violation. */
export class BlockManifestError extends Error {
  override readonly name = 'BlockManifestError';
  constructor(
    message: string,
    /** Dot-path to the offending field, e.g. `iframe.sandbox`. */
    readonly field?: string,
  ) {
    super(message);
  }
}

export interface DefineBlockConfig {
  manifest: BlockManifest;
  // v2 will add an optional `render` callback for inline-mode hosts. It is
  // intentionally absent here so the SDK stays free of DOM-typed surface
  // until the inline runtime ships.
}

/**
 * Validates the manifest and returns it unchanged. Acts as a typed identity
 * function — call it at module scope (or from the build) so violations throw
 * before the app mounts. Enforces every machine-checkable rule in the canonical
 * `block.manifest.json` schema, plus the documented extras in
 * {@link SCHEMA_DIVERGENCES}; see {@link KNOWN_GAPS} for what only the server
 * can check. Throws {@link BlockManifestError} (with a `.field` dot-path).
 *
 * The example below is kept byte-identical to `test/blocks/defineBlock.example.ts`,
 * which is compiled and executed by the suite — a guard fails if they drift, so
 * this snippet both type-checks and runs.
 *
 * @example
 * import { defineBlock } from '@civitai/app-sdk/blocks';
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

  if (manifest == null || typeof manifest !== 'object') {
    throw new BlockManifestError('manifest must be an object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      throw new BlockManifestError(`manifest.${field} is required`, field);
    }
  }

  // Server-owned fields first, so a dev-set value gets the pointed message
  // rather than a downstream type complaint.
  if ((manifest as { trustTier?: unknown }).trustTier !== undefined) {
    throw new BlockManifestError(`manifest.trustTier ${SERVER_OWNED_MESSAGE}`, 'trustTier');
  }

  if (manifest.$schema !== undefined) {
    if (manifest.$schema !== EXPECTED_SCHEMA_URL) {
      throw new BlockManifestError(
        `manifest.$schema must be "${EXPECTED_SCHEMA_URL}" (or omitted)`,
        '$schema',
      );
    }
  }

  // Not a canonical property — `appId` belongs in `civitai.app.json`. Tolerated
  // and shape-checked; never required. See SCHEMA_DIVERGENCES.appId.
  if (manifest.appId !== undefined) requireNonEmptyString(manifest.appId, 'appId');

  requireNonEmptyString(manifest.blockId, 'blockId');
  if (
    manifest.blockId.length < BLOCK_ID_MIN_LENGTH ||
    manifest.blockId.length > BLOCK_ID_MAX_LENGTH ||
    !BLOCK_ID_PATTERN.test(manifest.blockId)
  ) {
    throw new BlockManifestError(
      `manifest.blockId must match ${BLOCK_ID_PATTERN} and be ${BLOCK_ID_MIN_LENGTH}-${BLOCK_ID_MAX_LENGTH} chars ` +
        `(lowercase, starts with a letter, ends alphanumeric, hyphen-separated — DNS-subdomain-safe since it becomes <blockId>.civit.ai). ` +
        `Got: ${JSON.stringify(manifest.blockId)}`,
      'blockId',
    );
  }

  requireNonEmptyString(manifest.version, 'version');
  if (!SEMVER_PATTERN.test(manifest.version)) {
    throw new BlockManifestError(
      `manifest.version must be semver (e.g. "0.1.0" or "1.2.3-beta.1"). Got: ${JSON.stringify(manifest.version)}`,
      'version',
    );
  }

  // The canonical declares `minLength: 1` and NO maxLength, saying so out loud:
  // "The server only requires a non-empty string (no length cap), so the CLI
  // does not impose one either." Neither does this.
  requireNonEmptyString(manifest.name, 'name');

  if (manifest.type !== undefined && !MANIFEST_TYPES.includes(manifest.type)) {
    throw new BlockManifestError(
      `manifest.type must be ${MANIFEST_TYPES.map((t) => `"${t}"`).join(' or ')} (or omitted). ` +
        `Got: ${JSON.stringify(manifest.type)}`,
      'type',
    );
  }

  if (!Array.isArray(manifest.scopes)) {
    throw new BlockManifestError('manifest.scopes must be an array', 'scopes');
  }
  for (const scope of manifest.scopes) {
    // Authoritative validity = membership in the canonical enum (BLOCK_SCOPES),
    // matching how the published schema validates `scopes`. The format pattern
    // is only used to pick a pointed error message.
    if (typeof scope !== 'string' || !KNOWN_BLOCK_SCOPES.has(scope)) {
      throw new BlockManifestError(buildScopeError(scope), 'scopes');
    }
  }

  if (manifest.scopeJustifications !== undefined) {
    validateScopeJustifications(manifest.scopeJustifications, manifest.scopes);
  }

  // `targets` is OPTIONAL in the canonical ("Optional for page-only apps") and
  // capped at 16. Each item requires only `slotId`.
  if (manifest.targets !== undefined) {
    if (!Array.isArray(manifest.targets)) {
      throw new BlockManifestError('manifest.targets must be an array', 'targets');
    }
    if (manifest.targets.length > TARGETS_MAX_ITEMS) {
      throw new BlockManifestError(
        `manifest.targets must have at most ${TARGETS_MAX_ITEMS} entries (got ${manifest.targets.length})`,
        'targets',
      );
    }
    manifest.targets.forEach((target, i) => validateTarget(target, i));
  }

  if (!CONTENT_RATINGS.includes(manifest.contentRating)) {
    throw new BlockManifestError(
      `manifest.contentRating must be one of ${CONTENT_RATINGS.join(', ')}. Got: ${JSON.stringify(manifest.contentRating)}`,
      'contentRating',
    );
  }

  // `category` is OPTIONAL. When present it must be one of the canonical
  // marketplace categories (mirrors the schema's `category` enum + the server's
  // MARKETPLACE_CATEGORIES). Omission is fine — a moderator categorises then.
  if (manifest.category !== undefined) {
    if (typeof manifest.category !== 'string' || !KNOWN_CATEGORIES.has(manifest.category)) {
      throw new BlockManifestError(
        `manifest.category must be one of ${BLOCK_CATEGORIES.join(', ')} (or omitted). ` +
          `Got: ${JSON.stringify(manifest.category)}`,
        'category',
      );
    }
  }

  if (manifest.renderMode !== undefined && !RENDER_MODES.includes(manifest.renderMode)) {
    throw new BlockManifestError(
      `manifest.renderMode must be one of ${RENDER_MODES.join(', ')} (or omitted). ` +
        `Got: ${JSON.stringify(manifest.renderMode)}`,
      'renderMode',
    );
  }

  // `tagline` is OPTIONAL. When present it must be a string whose TRIMMED length
  // is 1..BLOCK_TAGLINE_MAX_LENGTH — mirroring the server's authoritative
  // BlockManifestValidator check (which also trims), so a padded-but-fitting
  // value is never rejected here and then accepted at submit. Omission is fine —
  // the store simply renders no tagline.
  if (manifest.tagline !== undefined) {
    const tagline = manifest.tagline;
    if (typeof tagline !== 'string' || tagline.trim().length === 0) {
      throw new BlockManifestError(
        `manifest.tagline must be a non-empty string (or omitted). Got: ${JSON.stringify(tagline)}`,
        'tagline',
      );
    }
    if (tagline.trim().length > BLOCK_TAGLINE_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.tagline must be at most ${BLOCK_TAGLINE_MAX_LENGTH} characters. Got: ${tagline.trim().length}`,
        'tagline',
      );
    }
  }

  if (manifest.repository !== undefined) {
    const repository = manifest.repository;
    if (typeof repository !== 'string' || repository.length === 0) {
      throw new BlockManifestError(
        `manifest.repository must be a non-empty string (or omitted). Got: ${JSON.stringify(repository)}`,
        'repository',
      );
    }
    if (repository.length > REPOSITORY_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.repository must be at most ${REPOSITORY_MAX_LENGTH} characters. Got: ${repository.length}`,
        'repository',
      );
    }
    if (!REPOSITORY_PATTERN.test(repository)) {
      throw new BlockManifestError(
        'manifest.repository must be an https:// link to a repository ROOT on github.com, ' +
          `gitlab.com or codeberg.org (e.g. "https://github.com/owner/repo"). Got: ${JSON.stringify(repository)}. ` +
          'NOTE: this is a coarse shape check — the server applies stricter per-segment rules.',
        'repository',
      );
    }
  }

  if (manifest.minApiVersion !== undefined) {
    requireNonEmptyString(manifest.minApiVersion, 'minApiVersion');
    if (!MIN_API_VERSION_PATTERN.test(manifest.minApiVersion)) {
      throw new BlockManifestError(
        `manifest.minApiVersion must be dot-separated integers (e.g. "1" or "1.0"). Got: ${JSON.stringify(manifest.minApiVersion)}`,
        'minApiVersion',
      );
    }
  }

  if (manifest.bootSkeleton !== undefined && typeof manifest.bootSkeleton !== 'boolean') {
    throw new BlockManifestError(
      `manifest.bootSkeleton must be a boolean (or omitted). Got: ${JSON.stringify(manifest.bootSkeleton)}`,
      'bootSkeleton',
    );
  }

  if (manifest.buildCommand !== undefined) {
    requireNonEmptyString(manifest.buildCommand, 'buildCommand');
    if (manifest.buildCommand.length > BUILD_COMMAND_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.buildCommand must be at most ${BUILD_COMMAND_MAX_LENGTH} characters. Got: ${manifest.buildCommand.length}`,
        'buildCommand',
      );
    }
    if (!BUILD_COMMAND_PATTERN.test(manifest.buildCommand)) {
      throw new BlockManifestError(
        'manifest.buildCommand must be one of the allowlisted build invocations: ' +
          '"npm run <script>", "pnpm run <script>", "yarn run <script>", "vite build" or ' +
          `"npx vite build". Got: ${JSON.stringify(manifest.buildCommand)}`,
        'buildCommand',
      );
    }
    // Canonical `allOf`: outputDir is required whenever buildCommand is set.
    if (manifest.outputDir === undefined || manifest.outputDir === null) {
      throw new BlockManifestError(
        'manifest.outputDir is required when manifest.buildCommand is set',
        'outputDir',
      );
    }
  }

  if (manifest.outputDir !== undefined) validateOutputDir(manifest.outputDir);

  if (manifest.publicSettingsKeys !== undefined) {
    validatePublicSettingsKeys(manifest.publicSettingsKeys);
  }

  if (manifest.assetBundleUrl !== undefined) {
    requireNonEmptyString(manifest.assetBundleUrl, 'assetBundleUrl');
    if (!ASSET_BUNDLE_URL_PATTERN.test(manifest.assetBundleUrl)) {
      throw new BlockManifestError(
        `manifest.assetBundleUrl must be a public https:// URL. Got: ${JSON.stringify(manifest.assetBundleUrl)}`,
        'assetBundleUrl',
      );
    }
  }

  // `iframe` is OPTIONAL in the canonical and has NO required sub-fields.
  if (manifest.iframe !== undefined) validateIframe(manifest.iframe);
  if (manifest.page !== undefined) validatePage(manifest.page);

  if (manifest.assets !== undefined) validateAssets(manifest.assets);
  if (manifest.settings !== undefined) validateSettings(manifest.settings);

  return manifest;
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BlockManifestError(`manifest.${field} must be a non-empty string`, field);
  }
}

function buildScopeError(scope: unknown): string {
  const shown = JSON.stringify(scope);
  const known = Object.values(BLOCK_SCOPES).join(', ');
  if (typeof scope === 'string' && PASCAL_CASE_PATTERN.test(scope)) {
    return (
      `Block scope strings must use colon-separated lowercase format ` +
      `(e.g. "models:read:self"), not PascalCase (e.g. "ModelsReadSelf"). Got: ${shown}`
    );
  }
  if (typeof scope === 'string' && !BLOCK_SCOPE_PATTERN.test(scope)) {
    return (
      `Block scope strings must match ${BLOCK_SCOPE_PATTERN} ` +
      `(three colon-separated lowercase segments, e.g. "models:read:self"). Got: ${shown}`
    );
  }
  // Well-formed but not one of the known/approved scopes.
  return (
    `manifest.scopes contains an unknown block scope ${shown}. ` +
    `Must be one of: ${known}.`
  );
}

/**
 * Canonical `scopeJustifications`: a map of scope-id → rationale, 1..500 chars,
 * every key also present in `scopes`. The "REQUIRED for sensitive scopes" half
 * is server-side only — see KNOWN_GAPS.
 */
function validateScopeJustifications(value: unknown, scopes: readonly string[]): void {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BlockManifestError(
      'manifest.scopeJustifications must be an object (scope-id → rationale)',
      'scopeJustifications',
    );
  }
  const declared = new Set(scopes);
  for (const [scope, rationale] of Object.entries(value as Record<string, unknown>)) {
    const path = `scopeJustifications.${scope}`;
    if (!declared.has(scope)) {
      throw new BlockManifestError(
        `manifest.${path} justifies a scope that is not in manifest.scopes. ` +
          'Every justification key must be a scope the manifest actually requests.',
        path,
      );
    }
    if (typeof rationale !== 'string' || rationale.length === 0) {
      throw new BlockManifestError(`manifest.${path} must be a non-empty string`, path);
    }
    if (rationale.length > SCOPE_JUSTIFICATION_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.${path} must be at most ${SCOPE_JUSTIFICATION_MAX_LENGTH} characters. Got: ${rationale.length}`,
        path,
      );
    }
  }
}

function validateTarget(target: unknown, index: number): void {
  const path = `targets[${index}]`;
  if (target == null || typeof target !== 'object') {
    throw new BlockManifestError(`manifest.${path} must be an object`, path);
  }
  const t = target as { slotId?: unknown; priority?: unknown };
  if (typeof t.slotId !== 'string' || t.slotId.length === 0) {
    throw new BlockManifestError(`manifest.${path}.slotId must be a non-empty string`, `${path}.slotId`);
  }
  // `priority` is NOT a canonical property — shape-checked when present, never
  // required. See SCHEMA_DIVERGENCES['targets[].priority'].
  if (t.priority !== undefined && (typeof t.priority !== 'number' || !Number.isInteger(t.priority))) {
    throw new BlockManifestError(`manifest.${path}.priority must be an integer`, `${path}.priority`);
  }
}

/**
 * Canonical `outputDir`: 1..256 chars, and none of four traversal/absolute
 * shapes (leading `/`, a backslash, a `..` segment, a Windows drive prefix).
 */
function validateOutputDir(value: unknown): void {
  requireNonEmptyString(value, 'outputDir');
  if (value.length > OUTPUT_DIR_MAX_LENGTH) {
    throw new BlockManifestError(
      `manifest.outputDir must be at most ${OUTPUT_DIR_MAX_LENGTH} characters. Got: ${value.length}`,
      'outputDir',
    );
  }
  const unsafe: ReadonlyArray<readonly [RegExp, string]> = [
    [/^\//, 'must be relative (no leading "/")'],
    [/\\/, 'must not contain a backslash separator'],
    [/(^|\/)\.\.(\/|$)/, 'must not contain a ".." path-traversal segment'],
    [/^[A-Za-z]:/, 'must not start with a Windows drive prefix'],
  ];
  for (const [pattern, why] of unsafe) {
    if (pattern.test(value)) {
      throw new BlockManifestError(
        `manifest.outputDir ${why}. Got: ${JSON.stringify(value)}`,
        'outputDir',
      );
    }
  }
}

function validatePublicSettingsKeys(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new BlockManifestError('manifest.publicSettingsKeys must be an array', 'publicSettingsKeys');
  }
  if (value.length > PUBLIC_SETTINGS_KEYS_MAX_ITEMS) {
    throw new BlockManifestError(
      `manifest.publicSettingsKeys must have at most ${PUBLIC_SETTINGS_KEYS_MAX_ITEMS} entries (got ${value.length})`,
      'publicSettingsKeys',
    );
  }
  value.forEach((key, i) => {
    const path = `publicSettingsKeys[${i}]`;
    if (typeof key !== 'string' || key.length === 0) {
      throw new BlockManifestError(`manifest.${path} must be a non-empty string`, path);
    }
    if (key.length > PUBLIC_SETTINGS_KEY_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.${path} must be at most ${PUBLIC_SETTINGS_KEY_MAX_LENGTH} characters. Got: ${key.length}`,
        path,
      );
    }
  });
}

function validateIframe(iframe: BlockManifest['iframe']): void {
  if (iframe == null || typeof iframe !== 'object' || Array.isArray(iframe)) {
    throw new BlockManifestError('manifest.iframe must be an object', 'iframe');
  }

  // The canonical sets `additionalProperties: false` on `iframe`.
  for (const key of Object.keys(iframe)) {
    if (!IFRAME_KEYS.has(key)) {
      throw new BlockManifestError(
        `manifest.iframe.${key} is not a known iframe property. Allowed: ${[...IFRAME_KEYS].join(', ')}.`,
        `iframe.${key}`,
      );
    }
  }

  // SERVER-OWNED. Required by this validator until #330 — the exact value
  // `civitai app submit` refuses. See SCHEMA_DIVERGENCES['iframe.src'].
  if ((iframe as { src?: unknown }).src !== undefined) {
    throw new BlockManifestError(`manifest.iframe.src ${SERVER_OWNED_MESSAGE}`, 'iframe.src');
  }

  if (iframe.sandbox !== undefined) {
    if (typeof iframe.sandbox !== 'string' || iframe.sandbox.length === 0) {
      throw new BlockManifestError(
        'manifest.iframe.sandbox must be a non-empty string',
        'iframe.sandbox',
      );
    }
    const tokens = new Set(iframe.sandbox.split(/\s+/).filter(Boolean));
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

  if (iframe.minHeight !== undefined) {
    validateIframeHeight(iframe.minHeight, 'iframe.minHeight', false);
  }
  if (iframe.maxHeight !== undefined && iframe.maxHeight !== null) {
    validateIframeHeight(iframe.maxHeight, 'iframe.maxHeight', true);
  }

  if (iframe.resizable !== undefined && typeof iframe.resizable !== 'boolean') {
    throw new BlockManifestError(
      'manifest.iframe.resizable must be a boolean',
      'iframe.resizable',
    );
  }
}

/** Canonical bounds: integer, 40..4000 px. `maxHeight` additionally allows null. */
function validateIframeHeight(value: unknown, field: string, nullable: boolean): void {
  const suffix = nullable ? ', null, or omitted' : ' (or omitted)';
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BlockManifestError(
      `manifest.${field} must be an integer${suffix}. Got: ${JSON.stringify(value)}`,
      field,
    );
  }
  if (value < IFRAME_HEIGHT_MIN || value > IFRAME_HEIGHT_MAX) {
    throw new BlockManifestError(
      `manifest.${field} must be between ${IFRAME_HEIGHT_MIN} and ${IFRAME_HEIGHT_MAX} px. Got: ${value}`,
      field,
    );
  }
}

/** Canonical `page`: additionalProperties false, `path` + `title` required. */
function validatePage(page: BlockManifest['page']): void {
  if (page == null || typeof page !== 'object' || Array.isArray(page)) {
    throw new BlockManifestError('manifest.page must be an object', 'page');
  }
  for (const key of Object.keys(page)) {
    if (!PAGE_KEYS.has(key)) {
      throw new BlockManifestError(
        `manifest.page.${key} is not a known page property. Allowed: ${[...PAGE_KEYS].join(', ')}.`,
        `page.${key}`,
      );
    }
  }
  requireNonEmptyString(page.path, 'page.path');
  if (!page.path.startsWith('/')) {
    throw new BlockManifestError(
      `manifest.page.path must start with "/". Got: ${JSON.stringify(page.path)}`,
      'page.path',
    );
  }
  if (page.path.length > PAGE_PATH_MAX_LENGTH) {
    throw new BlockManifestError(
      `manifest.page.path must be at most ${PAGE_PATH_MAX_LENGTH} characters. Got: ${page.path.length}`,
      'page.path',
    );
  }
  requireNonEmptyString(page.title, 'page.title');
  if (page.title.length > PAGE_TITLE_MAX_LENGTH) {
    throw new BlockManifestError(
      `manifest.page.title must be at most ${PAGE_TITLE_MAX_LENGTH} characters. Got: ${page.title.length}`,
      'page.title',
    );
  }
  if (page.icon !== undefined) {
    if (typeof page.icon !== 'string') {
      throw new BlockManifestError('manifest.page.icon must be a string', 'page.icon');
    }
    if (page.icon.length > PAGE_ICON_MAX_LENGTH) {
      throw new BlockManifestError(
        `manifest.page.icon must be at most ${PAGE_ICON_MAX_LENGTH} characters. Got: ${page.icon.length}`,
        'page.icon',
      );
    }
  }
  if (page.buzzBudgetPerGen !== undefined) {
    const budget = page.buzzBudgetPerGen;
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
      throw new BlockManifestError(
        `manifest.page.buzzBudgetPerGen must be a positive integer. Got: ${JSON.stringify(budget)}`,
        'page.buzzBudgetPerGen',
      );
    }
  }
}

function validateAssets(assets: BlockManifest['assets']): void {
  if (!Array.isArray(assets)) {
    throw new BlockManifestError('manifest.assets must be an array', 'assets');
  }
  assets.forEach((asset, i) => {
    const path = `assets[${i}]`;
    if (asset == null || typeof asset !== 'object') {
      throw new BlockManifestError(`manifest.${path} must be an object`, path);
    }
    const a = asset as { url?: unknown; integrity?: unknown };
    if (typeof a.url !== 'string' || a.url.length === 0) {
      throw new BlockManifestError(`manifest.${path}.url must be a non-empty string`, `${path}.url`);
    }
    if (typeof a.integrity !== 'string' || !SRI_PATTERN.test(a.integrity)) {
      throw new BlockManifestError(
        `manifest.${path}.integrity must be a SubresourceIntegrity hash ` +
          `(sha256/384/512-<base64>). Got: ${JSON.stringify(a.integrity)}`,
        `${path}.integrity`,
      );
    }
  });
}

/**
 * W3 v0 settings validation. Manifest authors declare fields as a record
 * keyed by snake_case field name; each entry carries scope, type, label,
 * description, and a widget hint. Mirrors the platform meta-schema
 * (`manifestSettingsSchema`) — keep both sides aligned. The canonical
 * app-block schema declares no `settings` property; see SCHEMA_DIVERGENCES.
 */
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
