import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  generateState,
  OAuthError,
  revokeToken,
} from '@civitai/app-sdk';
import { scopesFromBitmask } from '@civitai/app-sdk/scopes';
import { env, REDIRECT_URI } from './env.js';
import { REQUESTED_SCOPES } from './scopes.js';
import {
  clearSession,
  consumeOAuthState,
  readSession,
  writeOAuthState,
  writeSession,
  type Session,
} from './session.js';
import {
  createOrchestratorClient,
  isTerminal,
  OrchestratorError,
  pollWorkflow,
} from '@civitai/app-sdk/orchestrator';
import {
  estimateGenerationCost,
  getMe,
  submitGeneration,
  type GenerateInput,
} from './civitai.js';

const production = process.env.NODE_ENV === 'production';

export const app = new Hono();

/**
 * Security headers on every BFF response. The production hardening path is a
 * CSP nonce — see https://hono.dev/docs/middleware/builtin/secure-headers.
 * The static policy here keeps HMR working in dev.
 */
const CIVITAI_HOSTS_BASE = [
  'https://civitai.com',
  'https://*.civitai.com',
  'https://civitai.red',
  'https://*.civitai.red',
  'https://orchestration.civitai.com',
  'https://orchestration-new.civitai.com',
  'https://image.civitai.com',
];

/** Fold the configured CIVITAI_AUTH_URL / CIVITAI_BASE_URL / ORCHESTRATOR_URL
 * origins into the CSP allow-list so a self-hosted Civitai dev (e.g.
 * https://civitai-dev.blue) works without users hand-editing CSP. */
function originOrNull(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

const CIVITAI_HOSTS = Array.from(
  new Set(
    [
      ...CIVITAI_HOSTS_BASE,
      originOrNull(env.CIVITAI_AUTH_URL),
      originOrNull(env.CIVITAI_BASE_URL),
      originOrNull(env.ORCHESTRATOR_URL),
    ].filter((host): host is string => Boolean(host)),
  ),
);

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', ...CIVITAI_HOSTS],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', ...CIVITAI_HOSTS],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", ...CIVITAI_HOSTS],
      objectSrc: ["'none'"],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    xContentTypeOptions: 'nosniff',
    // Disable strict-transport-security in dev (we serve HTTP); production
    // behind a TLS terminator should re-enable it.
    strictTransportSecurity: production ? 'max-age=31536000; includeSubDomains' : false,
  }),
);

// --- helpers ---------------------------------------------------------------

/** Read & decrypt the session cookie, or return a 401 JSON response. */
async function requireSession(
  c: Context,
): Promise<{ session: Session } | { response: Response }> {
  const session = await readSession(c, production);
  if (!session) return { response: c.json({ error: 'not_authenticated' }, 401) };
  return { session };
}

/** Parse a GenerateInput body, rejecting with 400 if `prompt` is missing. */
async function parseGenerateInput(
  c: Context,
): Promise<{ input: GenerateInput } | { response: Response }> {
  const body = (await c.req.json().catch(() => null)) as GenerateInput | null;
  if (!body?.prompt || typeof body.prompt !== 'string') {
    return { response: c.json({ error: 'prompt is required' }, 400) };
  }
  return { input: body };
}

/** Map an OrchestratorError onto a JSON response; rethrow everything else. */
function handleOrchestratorError(c: Context, err: unknown): Response {
  if (err instanceof OrchestratorError) {
    return c.json(
      { error: 'orchestrator_error', detail: err.body },
      err.status as Parameters<typeof c.json>[1],
    );
  }
  return c.json({ error: 'unknown' }, 500);
}

// --- health ----------------------------------------------------------------

const STARTED_AT = Date.now();

/** Liveness probe — never touches Civitai. Used by container platforms and
 * by the repo's e2e runner to know when the dev server is actually serving. */
app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    startedAt: new Date(STARTED_AT).toISOString(),
  });
});

// --- auth ------------------------------------------------------------------

app.post('/api/auth/login', (c) => {
  const pkce = generatePkce();
  const state = generateState();

  writeOAuthState(c, { state, verifier: pkce.verifier, scope: REQUESTED_SCOPES }, production);

  const authorizeUrl = buildAuthorizeUrl({
    baseUrl: env.CIVITAI_AUTH_URL,
    clientId: env.CIVITAI_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: REQUESTED_SCOPES,
    state,
    codeChallenge: pkce.challenge,
  });

  return c.redirect(authorizeUrl, 303);
});

app.get('/api/auth/callback/civitai', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthErr = c.req.query('error');

  const expected = consumeOAuthState(c, production);

  if (oauthErr) return c.redirect(`/?error=${encodeURIComponent('oauth_error:' + oauthErr)}`, 303);
  if (!code || !state) return c.redirect('/?error=missing_code_or_state', 303);
  if (!expected || expected.state !== state) return c.redirect('/?error=state_mismatch', 303);

  try {
    const tokens = await exchangeCode({
      baseUrl: env.CIVITAI_AUTH_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code,
      codeVerifier: expected.verifier,
    });
    writeSession(c, { tokens }, production);
  } catch (err) {
    const msg = err instanceof OAuthError ? `token_exchange:${err.status}` : 'token_exchange_failed';
    return c.redirect(`/?error=${encodeURIComponent(msg)}`, 303);
  }

  return c.redirect('/?notice=connected', 303);
});

app.post('/api/auth/logout', (c) => {
  clearSession(c, production);
  return c.json({ ok: true });
});

app.post('/api/auth/revoke', async (c) => {
  const session = await readSession(c, production);
  if (session?.tokens.access_token) {
    const revokeOne = async (token: string) => {
      try {
        await revokeToken({
          baseUrl: env.CIVITAI_AUTH_URL,
          clientId: env.CIVITAI_CLIENT_ID,
          clientSecret: env.CIVITAI_CLIENT_SECRET,
          token,
        });
      } catch {
        // Best-effort: clear the local session even if Civitai rejects the
        // revocation (e.g. token already expired).
      }
    };
    await revokeOne(session.tokens.access_token);
    if (session.tokens.refresh_token) await revokeOne(session.tokens.refresh_token);
  }
  clearSession(c, production);
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const auth = await requireSession(c);
  if ('response' in auth) return c.json({ authenticated: false }, 401);
  try {
    const me = await getMe(auth.session);
    return c.json({
      authenticated: true,
      username: me.username,
      balance: me.balance,
      grantedScopes: scopesFromBitmask(auth.session.tokens.scope),
    });
  } catch (err) {
    return c.json(
      { authenticated: true, error: err instanceof Error ? err.message : 'fetch_failed' },
      502,
    );
  }
});

// --- generation ------------------------------------------------------------

app.post('/api/generate/estimate', async (c) => {
  const auth = await requireSession(c);
  if ('response' in auth) return auth.response;
  const parsed = await parseGenerateInput(c);
  if ('response' in parsed) return parsed.response;

  try {
    const snapshot = await estimateGenerationCost(auth.session, parsed.input);
    return c.json({ cost: snapshot.cost?.total ?? 0, snapshot });
  } catch (err) {
    return handleOrchestratorError(c, err);
  }
});

app.post('/api/generate', async (c) => {
  const auth = await requireSession(c);
  if ('response' in auth) return auth.response;
  const parsed = await parseGenerateInput(c);
  if ('response' in parsed) return parsed.response;

  try {
    const snapshot = await submitGeneration(auth.session, parsed.input);
    return c.json({ workflowId: snapshot.id, snapshot });
  } catch (err) {
    return handleOrchestratorError(c, err);
  }
});

// Long-poll workflow status. `?wait=<ms>` (capped at MAX_WAIT_MS) holds the
// connection open until terminal, then returns. Clients keep calling until
// `done: true`.
const MAX_WAIT_MS = 30_000;

app.get('/api/workflow/:id', async (c) => {
  const auth = await requireSession(c);
  if ('response' in auth) return auth.response;
  const id = c.req.param('id');

  const waitRaw = Number(c.req.query('wait') ?? 0);
  const waitMs = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), MAX_WAIT_MS) : 0;

  const client = createOrchestratorClient({
    accessToken: auth.session.tokens.access_token,
    baseUrl: env.ORCHESTRATOR_URL,
  });

  try {
    const snapshot = await pollWorkflow(client, id, {
      timeoutMs: waitMs,
      signal: c.req.raw.signal,
    });
    return c.json({ snapshot, done: isTerminal(snapshot) });
  } catch (err) {
    return handleOrchestratorError(c, err);
  }
});

export default app;
