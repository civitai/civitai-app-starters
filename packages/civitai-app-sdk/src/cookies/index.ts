import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Sealed cookie format: `${iv}:${tag}:${ciphertext}` (all hex).
 *
 * AES-256-GCM (authenticated encryption — AEAD). Wrong secret or tampered
 * ciphertext causes decryption to throw, which `unsealCookie` catches and
 * returns `null`. This is a security upgrade over plain AES-CTR (which is
 * malleable and silently returns garbage on wrong keys).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SALT = 'civitai-app-sdk-cookie-salt';

/**
 * Derived keys, memoized by secret.
 *
 * 🔴 `scryptSync` IS DELIBERATELY EXPENSIVE — Node's defaults (N=16384, r=8)
 * cost ~16MB and tens of milliseconds PER CALL. The salt is a compile-time
 * constant and the secret is a long-lived env value, so the key for a given
 * secret is the same forever; re-deriving it on every request was pure burn.
 *
 * This is the one piece of module state in the package, and it is sanctioned
 * for the same reason `src/safe-storage/` is: it is a pure cache of a pure
 * function, keyed on its only input. It holds no per-user data — a *secret*
 * is not a *token*, and the `Tokens live in arguments, never module state`
 * rule is about the latter.
 *
 * A server has exactly one `SESSION_SECRET`, so this map holds one entry. It
 * is unbounded only in the sense that a caller who feeds it unbounded distinct
 * secrets would grow it — but such a caller is already paying an unbounded
 * number of scrypt runs, which is the far larger problem.
 */
const keyCache = new Map<string, Buffer>();

function getKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const derived = scryptSync(secret, SALT, KEY_BYTES);
  keyCache.set(secret, derived);
  return derived;
}

/**
 * Encrypt an arbitrary string for storage in a cookie value.
 * Returns `${iv}:${tag}:${ciphertext}`, hex-encoded.
 *
 * The `secret` should be a high-entropy value held server-side only,
 * supplied via env (e.g. SESSION_SECRET). Treat it like a session key.
 */
export function sealCookie(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Reverse of `sealCookie`. Returns `null` on any error (tampered, wrong
 * secret, malformed) — never throws. Callers should treat `null` as
 * "session missing or invalid" and re-issue.
 */
export function unsealCookie(sealed: string, secret: string): string | null {
  try {
    const parts = sealed.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, ctHex] = parts;
    if (!ivHex || !tagHex || !ctHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ctHex, 'hex');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    // 🔴 EVERY CHECK ABOVE THIS LINE IS FREE; `getKey` BELOW IT IS NOT — see the
    // `keyCache` note. The sealed value arrives from a cookie, i.e. from an
    // UNAUTHENTICATED client, so anything rejectable without a key must be
    // rejected before the KDF. `Buffer.from(x, 'hex')` decodes leniently — it
    // stops at the first non-hex character and returns what it got — so a
    // ciphertext field of `zz` yields ZERO bytes while passing every check
    // above. Zero bytes can never be a valid seal: `sealCookie('')` emits an
    // empty `ctHex`, which the `!ctHex` guard already rejects.
    if (ciphertext.length === 0) return null;
    const decipher = createDecipheriv(ALGORITHM, getKey(secret), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

export interface CookieAttributes {
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

/** Build a `Set-Cookie` header value with sensible defaults for session cookies. */
export function buildSetCookieHeader(
  name: string,
  value: string,
  attrs: CookieAttributes = {},
): string {
  const parts = [`${name}=${value}`];
  parts.push(`Max-Age=${attrs.maxAge ?? 3600}`);
  parts.push(`Path=${attrs.path ?? '/'}`);
  if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
  if (attrs.secure !== false) parts.push('Secure');
  if (attrs.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${attrs.sameSite ?? 'lax'}`);
  return parts.join('; ');
}

/** Parse a `Cookie` request header and return a value by name, or null. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const target = `${name}=`;
  for (const raw of cookieHeader.split(';')) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(target)) return trimmed.slice(target.length);
  }
  return null;
}
