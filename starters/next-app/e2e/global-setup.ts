import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * One-time setup: sign in to the local Civitai dev server as the test user
 * via the `testing-login` NextAuth credentials provider (dev/test only),
 * then write the resulting cookies to a Playwright storageState JSON. Each
 * spec loads this state via `use.storageState` in playwright.config.ts.
 *
 * Uses plain Node fetch + a tiny cookie jar for the sign-in handshake, then
 * hand-builds the storageState file. Playwright's own request contexts
 * don't reliably persist the NextAuth session cookie in this flow.
 */

export const STORAGE_STATE_PATH = '.auth/civitai-session.json';

interface PwCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is required for e2e. See playwright.config.ts header for the full prereq list.`,
    );
  }
  return v;
}

interface ParsedCookie {
  name: string;
  value: string;
  attrs: Map<string, string | true>;
}

function parseSetCookie(line: string): ParsedCookie {
  const parts = line.split(';');
  const head = parts[0] ?? '';
  const eq = head.indexOf('=');
  const name = head.slice(0, eq).trim();
  const value = head.slice(eq + 1).trim();
  const attrs = new Map<string, string | true>();
  for (const p of parts.slice(1)) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const pe = trimmed.indexOf('=');
    if (pe === -1) attrs.set(trimmed.toLowerCase(), true);
    else attrs.set(trimmed.slice(0, pe).toLowerCase(), trimmed.slice(pe + 1));
  }
  return { name, value, attrs };
}

function toPwCookie(parsed: ParsedCookie, defaultDomain: string): PwCookie {
  const sameSiteRaw = String(parsed.attrs.get('samesite') ?? 'Lax');
  const sameSite =
    sameSiteRaw.toLowerCase() === 'strict'
      ? 'Strict'
      : sameSiteRaw.toLowerCase() === 'none'
        ? 'None'
        : 'Lax';
  const domain = String(parsed.attrs.get('domain') ?? defaultDomain).replace(/^\./, '');
  return {
    name: parsed.name,
    value: parsed.value,
    domain,
    path: String(parsed.attrs.get('path') ?? '/'),
    expires: -1, // session cookie
    httpOnly: !!parsed.attrs.get('httponly'),
    secure: !!parsed.attrs.get('secure'),
    sameSite,
  };
}

export default async function globalSetup(_config: FullConfig) {
  // Local Civitai dev often uses a self-signed (and sometimes expired) cert
  // on a custom hostname (e.g. https://civitai-dev.blue). Disable TLS
  // verification for this setup process — affects only globalSetup, not the
  // test browsers (those use Playwright's ignoreHTTPSErrors).
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const civitaiBaseUrl = requireEnv('CIVITAI_BASE_URL');
  const userId = process.env.TEST_USER_ID ?? '1';
  const civitaiHost = new URL(civitaiBaseUrl).hostname;

  // ---- plain fetch + cookie jar ----
  // Two-layer storage: the live jar (for sending Cookie on subsequent
  // requests) and the parsed list (for constructing the Playwright file).
  const jar = new Map<string, string>();
  const parsed = new Map<string, ParsedCookie>();

  const cookieHeader = () =>
    Array.from(jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  async function req(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers ?? {});
    if (jar.size) headers.set('cookie', cookieHeader());
    const res = await fetch(`${civitaiBaseUrl}${path}`, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const p = parseSetCookie(line);
      if (!p.name) continue;
      if (p.value === '' || /^deleted$/i.test(p.value)) {
        jar.delete(p.name);
        parsed.delete(p.name);
      } else {
        jar.set(p.name, p.value);
        parsed.set(p.name, p);
      }
    }
    return res;
  }

  // 1. CSRF
  const csrfRes = await req('/api/auth/csrf');
  if (!csrfRes.ok) throw new Error(`GET /api/auth/csrf failed (${csrfRes.status})`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // 2. testing-login
  const form = new URLSearchParams({
    csrfToken,
    id: userId,
    callbackUrl: `${civitaiBaseUrl}/`,
    json: 'true',
  });
  const loginRes = await req('/api/auth/callback/testing-login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (loginRes.status >= 400) {
    throw new Error(
      `testing-login POST failed (${loginRes.status}): ${(await loginRes.text()).slice(0, 500)}`,
    );
  }

  // 3. Verify the session is live in our local jar.
  const sessionRes = await req('/api/auth/session');
  const session = (await sessionRes.json()) as { user?: { id?: number } };
  const gotId = session?.user?.id;
  if (Number(gotId) !== Number(userId)) {
    throw new Error(
      `testing-login succeeded but /api/auth/session has no matching user.\n` +
        `  Got: ${JSON.stringify(session)}\n` +
        `  Expected user id: ${userId}\n` +
        `Is the testing-login provider enabled (NODE_ENV=development on Civitai)?`,
    );
  }

  // 4. Convert captured cookies into Playwright storageState shape and write.
  const cookies: PwCookie[] = Array.from(parsed.values()).map((p) => toPwCookie(p, civitaiHost));
  const state = { cookies, origins: [] };

  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });
  await writeFile(STORAGE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');

  console.log(
    `[e2e] signed in as user ${userId} on ${civitaiBaseUrl}; ${cookies.length} cookies → ${STORAGE_STATE_PATH}`,
  );
}
