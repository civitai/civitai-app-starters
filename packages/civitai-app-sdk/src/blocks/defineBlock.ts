/**
 * Build-time / startup validation for a `BlockManifestV1`.
 *
 * This is a subset of what the civitai/civitai server enforces — the client
 * runs it so authoring mistakes surface in `pnpm dev` rather than at
 * `civitai deploy` time. Rules here MUST stay a strict subset of the
 * server's; if the server tightens, mirror the change here.
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
 * Canonical `blockId` rule (https://civitai.com/schemas/app-block/v1.json):
 * lowercase, must start with a letter, end alphanumeric, hyphen-separated,
 * 3–40 chars. This is the DNS-subdomain-safe rule — the blockId becomes
 * `<blockId>.civit.ai`, so it must be a valid DNS label.
 */
const BLOCK_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const BLOCK_ID_MIN_LENGTH = 3;
const BLOCK_ID_MAX_LENGTH = 40;
/** The 15 canonical block scopes (enum the schema validates `scopes` against). */
const KNOWN_BLOCK_SCOPES = new Set<string>(Object.values(BLOCK_SCOPES));
/** The 7 canonical marketplace categories (enum the schema validates `category` against). */
const KNOWN_CATEGORIES = new Set<string>(BLOCK_CATEGORIES);
const NAME_MAX_LENGTH = 80;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Detects the SubresourceIntegrity hash format (sha256/384/512 + base64). */
const SRI_PATTERN = /^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/;
/** Heuristic for "looks PascalCase" — used only to pick the pointed error message. */
const PASCAL_CASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const EXPECTED_SCHEMA_URL = 'https://civitai.com/schemas/app-block/v1.json';

const CONTENT_RATINGS: readonly ContentRating[] = ['g', 'pg', 'pg13', 'r', 'x'];
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

const REQUIRED_FIELDS = [
  '$schema',
  'appId',
  'blockId',
  'version',
  'name',
  'type',
  'targets',
  'scopes',
  'iframe',
  'contentRating',
  'minApiVersion',
] as const satisfies ReadonlyArray<keyof BlockManifest>;

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
 * function — call it at module scope in the block app so violations throw
 * before the app mounts. Mirrors a strict subset of the civitai/civitai server
 * gate, so authoring mistakes surface in `pnpm dev` instead of at submit time.
 * Throws {@link BlockManifestError} (with a `.field` dot-path) on a bad manifest.
 *
 * @example
 * import { defineBlock } from '@civitai/app-sdk/blocks';
 *
 * export const manifest = defineBlock({
 *   manifest: {
 *     $schema: 'https://civitai.com/schemas/app-block/v1.json',
 *     appId: 'my-app',
 *     blockId: 'my-block',
 *     version: '1.0.0',
 *     name: 'My Block',
 *     type: 'block',
 *     targets: [{ slotId: 'model.sidebar_top', priority: 100 }],
 *     scopes: ['ai:write:budgeted'],
 *     iframe: { src: 'https://my-block.civit.ai/', minHeight: 200 },
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

  if (manifest.$schema !== EXPECTED_SCHEMA_URL) {
    throw new BlockManifestError(
      `manifest.$schema must be "${EXPECTED_SCHEMA_URL}"`,
      '$schema',
    );
  }

  requireNonEmptyString(manifest.appId, 'appId');

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

  requireNonEmptyString(manifest.name, 'name');
  if (manifest.name.length > NAME_MAX_LENGTH) {
    throw new BlockManifestError(
      `manifest.name must be ${NAME_MAX_LENGTH} characters or fewer (got ${manifest.name.length})`,
      'name',
    );
  }

  if (manifest.type !== 'block' && manifest.type !== 'embed') {
    throw new BlockManifestError(
      `manifest.type must be "block" or "embed". Got: ${JSON.stringify(manifest.type)}`,
      'type',
    );
  }

  if (!Array.isArray(manifest.scopes) || manifest.scopes.length === 0) {
    throw new BlockManifestError('manifest.scopes must be a non-empty array', 'scopes');
  }
  for (const scope of manifest.scopes) {
    // Authoritative validity = membership in the canonical enum (BLOCK_SCOPES),
    // matching how the published schema validates `scopes`. The format pattern
    // is only used to pick a pointed error message.
    if (typeof scope !== 'string' || !KNOWN_BLOCK_SCOPES.has(scope)) {
      throw new BlockManifestError(buildScopeError(scope), 'scopes');
    }
  }

  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    throw new BlockManifestError('manifest.targets must be a non-empty array', 'targets');
  }
  manifest.targets.forEach((target, i) => validateTarget(target, i));

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

  requireNonEmptyString(manifest.minApiVersion, 'minApiVersion');

  validateIframe(manifest.iframe);

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

function validateTarget(target: unknown, index: number): void {
  const path = `targets[${index}]`;
  if (target == null || typeof target !== 'object') {
    throw new BlockManifestError(`manifest.${path} must be an object`, path);
  }
  const t = target as { slotId?: unknown; priority?: unknown };
  if (typeof t.slotId !== 'string' || t.slotId.length === 0) {
    throw new BlockManifestError(`manifest.${path}.slotId must be a non-empty string`, `${path}.slotId`);
  }
  if (typeof t.priority !== 'number' || !Number.isInteger(t.priority)) {
    throw new BlockManifestError(`manifest.${path}.priority must be an integer`, `${path}.priority`);
  }
}

function validateIframe(iframe: BlockManifest['iframe']): void {
  if (iframe == null || typeof iframe !== 'object') {
    throw new BlockManifestError('manifest.iframe must be an object', 'iframe');
  }

  if (typeof iframe.src !== 'string' || iframe.src.length === 0) {
    throw new BlockManifestError('manifest.iframe.src must be a non-empty string', 'iframe.src');
  }
  if (!isAllowedIframeSrc(iframe.src)) {
    throw new BlockManifestError(
      `manifest.iframe.src must use https:// (http:// only accepted for localhost/127.0.0.1/[::1]/*.localhost). Got: ${JSON.stringify(iframe.src)}`,
      'iframe.src',
    );
  }

  if (typeof iframe.sandbox !== 'string') {
    throw new BlockManifestError('manifest.iframe.sandbox must be a string', 'iframe.sandbox');
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

  if (typeof iframe.minHeight !== 'number' || !Number.isInteger(iframe.minHeight) || iframe.minHeight <= 0) {
    throw new BlockManifestError(
      'manifest.iframe.minHeight must be a positive integer',
      'iframe.minHeight',
    );
  }

  if (
    iframe.maxHeight !== undefined &&
    iframe.maxHeight !== null &&
    (typeof iframe.maxHeight !== 'number' || !Number.isInteger(iframe.maxHeight) || iframe.maxHeight <= 0)
  ) {
    throw new BlockManifestError(
      'manifest.iframe.maxHeight must be a positive integer, null, or omitted',
      'iframe.maxHeight',
    );
  }

  if (typeof iframe.resizable !== 'boolean') {
    throw new BlockManifestError(
      'manifest.iframe.resizable must be a boolean',
      'iframe.resizable',
    );
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
 * description, and a widget hint. This is a strict subset of the platform
 * meta-schema (`manifestSettingsSchema`) — keep both sides aligned.
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

function isAllowedIframeSrc(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  // Reject URLs with no host even if they parse (e.g. "https://" alone, which
  // some URL parsers permit).
  if (!url.hostname) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  // RFC 6761 reserves `.localhost` for loopback.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '127.0.0.1') return true;
  // IPv6 loopback. WHATWG URL parses "[::1]" → hostname "[::1]" or "::1".
  if (host === '[::1]' || host === '::1') return true;
  return false;
}
