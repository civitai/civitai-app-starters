/**
 * Seam guard for the session refresh in every standalone starter
 * (civitai/civitai-app-starters#804, #855): each starter's session code must
 * refresh THROUGH its copy of `refresh-tokens.ts` (single flight, backoff,
 * wait cap), clear the cookie only behind `isDefiniteRejection`, and forget
 * the session's remembered refreshes on sign-out, and revoke the STORED tokens
 * without refreshing first. `tests/refresh-tokens.test.mjs`
 * tests the module; this pins that the starter calls it.
 *
 * 🔴 STRUCTURAL, NOT BEHAVIOURAL. Each starter's `probe:expired-session` is the
 * behavioural check (a real build against a stand-in Civitai). This exists so
 * a refactor that quietly goes back to calling the SDK's `refreshToken()`
 * directly — which compiles and works on the happy path — fails here by name.
 * It lives in the repo, not in a starter, for the same reason as
 * `starter-estimate-seam.test.mjs`: a starter's own tests ship into every copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'starters');
const read = (starter, rel) => readFileSync(resolve(STARTERS, starter, rel), 'utf8');

const LAYOUT = {
  'next-app': {
    module: 'src/lib/refresh-tokens.ts',
    refresher: 'src/proxy.ts',
    importFrom: "'@/lib/refresh-tokens'",
    sessionFile: 'src/lib/session.ts',
    sessionImportFrom: "'./refresh-tokens'",
    signOut: ['src/app/api/auth/logout/route.ts', 'src/app/api/auth/revoke/route.ts'],
    signOutCall: /await clearSession\(\);/,
    roots: ['src'],
    revoke: { file: 'src/app/api/auth/revoke/route.ts', reads: /await getStoredSession\(\)/, notReads: /\bgetSession\(\)/ },
    skipsSignOut: { file: 'src/proxy.ts', pattern: /if \(SIGN_OUT_PATHS\.has\(request\.nextUrl\.pathname\)\) return NextResponse\.next\(\);/ },
  },
  'sveltekit-app': {
    module: 'src/lib/refresh-tokens.ts',
    refresher: 'src/lib/session.ts',
    importFrom: "'./refresh-tokens'",
    sessionFile: 'src/lib/session.ts',
    sessionImportFrom: "'./refresh-tokens'",
    signOut: ['src/routes/api/auth/logout/+server.ts', 'src/routes/api/auth/revoke/+server.ts'],
    signOutCall: /clearSession\(cookies, !dev\);/,
    roots: ['src'],
    revoke: { file: 'src/routes/api/auth/revoke/+server.ts', reads: /parseSession\(cookies\)\?\.tokens/, notReads: /locals\.session/ },
    skipsSignOut: { file: 'src/hooks.server.ts', pattern: /SIGN_OUT_PATHS\.has\(event\.url\.pathname\)\s*\?\s*null/ },
  },
  'react-pwa': {
    module: 'server/refresh-tokens.ts',
    refresher: 'server/session.ts',
    importFrom: "'./refresh-tokens.js'",
    sessionFile: 'server/session.ts',
    sessionImportFrom: "'./refresh-tokens.js'",
    signOut: ['server/app.ts'],
    signOutCall: /clearSession\(c, production\);/,
    roots: ['src', 'server'],
    revoke: { file: 'server/app.ts', route: "app.post('/api/auth/revoke'", reads: /parseSession\(c\)/, notReads: /readSession\(/ },
  },
  'svelte-pwa': {
    module: 'server/refresh-tokens.ts',
    refresher: 'server/session.ts',
    importFrom: "'./refresh-tokens.js'",
    sessionFile: 'server/session.ts',
    sessionImportFrom: "'./refresh-tokens.js'",
    signOut: ['server/app.ts'],
    signOutCall: /clearSession\(c, production\);/,
    roots: ['src', 'server'],
    revoke: { file: 'server/app.ts', route: "app.post('/api/auth/revoke'", reads: /parseSession\(c\)/, notReads: /readSession\(/ },
  },
};

function sourceFiles(starter, roots) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|svelte|js|mjs)$/.test(entry.name)) out.push(relative(resolve(STARTERS, starter), full));
    }
  };
  for (const root of roots) walk(resolve(STARTERS, starter, root));
  return out;
}

for (const [starter, l] of Object.entries(LAYOUT)) {
  test(`${starter}: the refresh goes through refreshTokensOnce and clears only on isDefiniteRejection`, () => {
    const src = read(starter, l.refresher);
    assert.match(src, new RegExp(`import \\{[^}]*\\brefreshTokensOnce\\b[^}]*\\} from ${l.importFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
    assert.match(src, /\bisDefiniteRejection\b[^}]*\} from/);
    assert.match(src, /await refreshTokensOnce\(\{/);
    assert.match(src, /\} catch \(err\) \{\s*if \(!isDefiniteRejection\(err\)\) \{/);
    // The bug: a bare catch that clears on every failure.
    assert.doesNotMatch(src, /\} catch \{\s*(clearSession|cookies\.delete|deleteCookie)/);
  });

  test(`${starter}: nothing but refresh-tokens.ts calls the SDK's refreshToken()`, () => {
    const files = sourceFiles(starter, l.roots);
    assert.ok(files.includes(l.module), `positive control: the walk must see ${l.module}`);
    const offenders = files.filter(
      (rel) => rel !== l.module && /\brefreshToken as\b|\boauthRefresh\(/.test(read(starter, rel)),
    );
    assert.deepEqual(offenders, [], 'refresh only through refreshTokensOnce');
  });

  test(`${starter}: signing out forgets the session's remembered refreshes`, () => {
    const session = read(starter, l.sessionFile);
    assert.match(session, new RegExp(`\\bforgetRefreshesFor\\b[^}]*\\} from ${l.sessionImportFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
    // Inside clearSession, before the cookie is cleared.
    const body = session.match(/export (?:async )?function clearSession\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1];
    assert.ok(body, 'clearSession must exist');
    const forget = body.indexOf('forgetRefreshesFor(');
    const clear = body.search(/writeCookie\(SESSION_COOKIE|cookies\.delete\(SESSION_COOKIE|deleteCookie\(c, SESSION_COOKIE/);
    assert.ok(forget !== -1 && clear !== -1 && forget < clear, 'clearSession must forget before it clears');
    // Every sign-out route goes through clearSession.
    const calls = l.signOut.map((rel) => read(starter, rel).match(new RegExp(l.signOutCall, 'g'))?.length ?? 0);
    assert.equal(
      calls.reduce((a, b) => a + b, 0),
      2,
      `expected exactly two sign-out call sites (logout, revoke) in ${l.signOut.join(', ')}`,
    );
  });

  test(`${starter}: revoke sends the STORED tokens upstream, and sign-out does not refresh`, () => {
    // A refresh that fails without invalid_grant leaves the refreshed-session
    // read null, which skipped the upstream revoke while the cookie was still
    // cleared. Behaviour is pinned by probe:expired-session's RT and S arms.
    // Comments name the old read on purpose; only code counts.
    const src = read(starter, l.revoke.file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    let body = src;
    if (l.revoke.route) {
      const at = src.indexOf(l.revoke.route);
      assert.ok(at !== -1, `${l.revoke.file} must define ${l.revoke.route}`);
      body = src.slice(at, src.indexOf('\n});', at));
    }
    assert.match(body, l.revoke.reads, 'revoke must read the stored session cookie');
    assert.doesNotMatch(body, l.revoke.notReads, 'revoke must not read the refreshed session');
    if (l.skipsSignOut) assert.match(read(starter, l.skipsSignOut.file), l.skipsSignOut.pattern);
  });
}
