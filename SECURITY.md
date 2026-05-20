# Security Policy

Thanks for helping keep `civitai-app-starters` — and the apps built from
it — safe.

## Reporting a vulnerability

**Do not file a public GitHub issue.** Email `security@civitai.com`
with:

- A description of the issue and the affected starter / SDK module.
- Steps to reproduce (proof-of-concept code or a redacted log is great).
- Your assessment of impact and which OAuth scopes / data are affected.

We aim to acknowledge reports within **3 business days** and ship a fix
or mitigation within **30 days** for high-severity issues. We'll credit
you in the release notes unless you'd rather stay anonymous.

## Scope

In scope:

- `@civitai/app-sdk` — OAuth (PKCE), encrypted-cookie session helpers,
  scope handling, orchestrator client.
- The four starter templates under `starters/` — auth flow, BFF routes,
  CSRF/CSP/header posture, env handling.

Out of scope:

- Vulnerabilities in third-party dependencies — please report those
  upstream. We'll bump the version once a fix is available.
- The Civitai API or `civitai.com` itself — see
  <https://civitai.com/security> for the platform's disclosure program.
- Apps **built from** the starter that have since diverged. The starter
  is a template, not a managed service.

## What we already do

- OAuth + PKCE on every starter; token exchange runs server-side and
  the browser only ever sees an opaque `httpOnly` session cookie.
- AES-256-CTR encrypted sessions via `@civitai/app-sdk`'s
  `sealCookie` / `unsealCookie` — no JWT-in-localStorage.
- Scope bitmasks via named constants; consent screens request only what
  the demo needs (`AIServicesWrite | BuzzRead | UserRead`).
- Playwright e2e suite exercises the real OAuth round-trip against a
  live Civitai dev environment.

## What we don't do (by design)

- We don't ship Redis, Postgres, or any external session store.
- We don't store `access_token` / `refresh_token` in the browser.
- We don't bake `CIVITAI_CLIENT_SECRET` into any client bundle.

See [`AGENTS.md`](./AGENTS.md) for the full list of patterns to keep and
to avoid.
