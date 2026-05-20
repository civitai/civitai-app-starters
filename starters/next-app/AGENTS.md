# Agent Guide — `next-app`

> **If you only read one thing:** this is a Next.js 15 App Router app whose
> only persistent state is an encrypted session cookie. OAuth tokens never
> leave the server. The demo: login → balance + scopes → cost preview →
> submit one generation → display.

You're inside the Next.js 15 App Router starter for Civitai apps. The user
cloned this via `npx tiged` to bootstrap their own app — there is **no
monorepo around you**; `@civitai/app-sdk` is an npm dependency, not a
sibling workspace. Help them extend it.

## Stack

- Next.js 15, App Router, TypeScript strict
- React 19
- Tailwind 3.4
- `@civitai/app-sdk` for all OAuth + orchestrator glue
- No DB, no Redis, no external session store — encrypted-cookie sessions only

## File layout

```
src/
├── app/
│   ├── layout.tsx          # root layout, Tailwind import
│   ├── page.tsx            # the demo home page
│   ├── globals.css
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts            # POST → start OAuth
│       │   ├── callback/civitai/route.ts # GET  → exchange code
│       │   ├── logout/route.ts           # POST → clear session
│       │   └── revoke/route.ts           # POST → revoke + clear
│       ├── generate/
│       │   ├── estimate/route.ts         # POST → whatif=true
│       │   └── route.ts                  # POST → submit
│       └── workflow/[id]/route.ts        # GET  → snapshot
├── components/             # client components (login button, prompt form, etc.)
└── lib/
    ├── env.ts              # validated env access
    ├── session.ts          # read/write the sealed session cookie
    └── civitai.ts          # @civitai/app-sdk wiring (createAppClient, fetchMe, etc.)
```

## Patterns to keep

- **OAuth + tokens stay server-side.** Never expose `access_token`, `refresh_token`, or `CIVITAI_CLIENT_SECRET` to the browser. The client only ever sees an opaque `httpOnly` `civ_session` cookie.
- **Session = sealed cookie.** Read via `getSession()` in `src/lib/session.ts`. If `null`, the user is logged out. Don't reach into the cookie store directly elsewhere.
- **All Civitai API calls happen in route handlers**, not React server components. RSCs can trigger route handlers via `fetch('/api/…')` or read session via `getSession()` and call helpers in `lib/civitai.ts` directly.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` and show the cost before submitting. Users blame the app, not Civitai, when they're surprised by Buzz spend.

## Patterns to avoid

- ❌ Storing tokens in `localStorage`, cookies-without-httpOnly, or in rendered HTML.
- ❌ Using the `next-auth` / `@auth/core` patterns from older Next.js tutorials — this starter intentionally does not use those.
- ❌ Hard-coding orchestrator base URLs — use the SDK defaults or env override.
- ❌ Adding new env vars without putting them in `.env.example` and validating them in `src/lib/env.ts`.
- ❌ Adding a database for "just storing some stuff" — make the user actively opt into infra. Suggest Vercel KV or Cloudflare D1 if they ask.

## Extending

| Task | How |
|---|---|
| Add a new Civitai API call | Add a function to `src/lib/civitai.ts` taking the session, returning typed result. Use the SDK's `createAppClient`. |
| Request more OAuth scopes | Edit `src/lib/scopes.ts` (`REQUESTED_SCOPES`). User will need to re-consent on next login. |
| Add a generation engine option | Edit the workflow body builder. Don't ship 30 engine configs — pick one or two that exemplify the pattern. |
| Persist generation history | This is **net-new infra** — flag it. Recommend Vercel KV for simple list/get, Postgres for richer queries. Don't silently add Prisma. |
| Add another OAuth provider | Don't — this is a Civitai-focused starter. Suggest the user pull a different starter or wire `better-auth` themselves. |

## Demo flow (read this before changing the home page)

1. Logged out → `<LoginButton>` → `POST /api/auth/login` → 302 to Civitai → user consents → `GET /api/auth/callback/civitai` → session sealed → 302 to `/`.
2. Logged in → `getSession()` on server → `fetchMe()` → render balance, scope summary, prompt form.
3. Submit prompt → client `POST /api/generate/estimate` → display Buzz cost → user confirms.
4. Client `POST /api/generate` → returns workflow ID → client polls `GET /api/workflow/[id]` every 2s.
5. On terminal status → display image(s) or error.

## Verifying changes

After any meaningful change, run the matching check before declaring done:

| You touched | Run |
|---|---|
| Anything in `src/` | `pnpm typecheck` |
| `next.config.mjs`, env wiring, security headers | `pnpm build` |
| Auth flow (`src/app/api/auth/**`), session helpers | `pnpm test:e2e -- auth-flow` |
| Generation flow (`src/app/api/generate/**`, workflow polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
and matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
