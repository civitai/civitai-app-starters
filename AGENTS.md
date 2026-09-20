# Agent Guide — Civitai App Starters

You're looking at a monorepo of starter templates for building apps on [Civitai](https://civitai.com), plus the shared `@civitai/app-sdk` and `@civitai/blocks-react` packages they depend on. Scaffolding, validation, and submit are handled by the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)) (`civitai login` + `civitai app init/validate/submit`); the local dev loop is the scaffolded project's own `npm run dev:harness`. The old `@civitai/blocks-cli` npm package is deprecated.

If you (the AI agent) were pointed here to scaffold a new Civitai app for your user, **do not clone this whole repo**. Pick one starter and pull just that subfolder.

## Pick a starter

| Use this when… | Starter |
|---|---|
| Building a **Civitai App** — iframe-embedded UI that renders inside a civitai.com page slot | `starters/civitai-block-starter` (scaffold with `civitai app init <name>` — the Go [`civitai` CLI](https://github.com/civitai/cli)) |
| App needs SEO / public-discoverable pages — gallery, landing, marketplace | `starters/next-app` (default for standalone apps) |
| App needs SEO and the team prefers Svelte | `starters/sveltekit-app` |
| App is a tool, mini-game, focused gen UI, in-app extension — no SEO required | `starters/react-pwa` |
| Same as above but the team prefers Svelte | `starters/svelte-pwa` |
| Unsure | `starters/next-app` |

Civitai Apps are a different shape from the standalone-app starters: no OAuth flow of their own, no BFF, no session cookies. The host civitai.com page mints a short-lived block-scoped JWT and ships it to the iframe via `BLOCK_INIT`. See [`packages/civitai-app-sdk/src/blocks/`](./packages/civitai-app-sdk/src/blocks/) for the contract and [`packages/civitai-blocks-react/`](./packages/civitai-blocks-react/) for the hooks.

## Cloning standalone

```bash
npx tiged civitai/civitai-app-starters/starters/next-app my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev
```

After cloning, see the chosen starter's own `AGENTS.md` and `README.md` for the specifics.

## Patterns to keep

These are validated in production by Civitai's own apps. Don't rewrite them; extend them.

- **OAuth + SDK glue lives in `@civitai/app-sdk`.** PKCE, token exchange, refresh, revoke, encrypted-cookie sessions, scope bitmask, and the orchestrator-client factory are all there. Each starter has a ~30-line framework adapter that calls these primitives. If you find yourself reimplementing any of those, stop — use the package.
- **Token exchange runs server-side.** Even in the PWA starters, the BFF (a single Hono route) does the OAuth token exchange. The browser never sees `client_secret` or the raw access token — only an opaque `httpOnly` session cookie.
- **Encrypted-cookie sessions.** AES-256-GCM via `@civitai/app-sdk`'s `sealCookie` / `unsealCookie`. No JWT-in-localStorage. No external session store.
- **Buzz is the user's, not the developer's.** When a user authenticates with OAuth and your app submits a generation, the orchestrator debits **the user's Buzz** via their token. App developers don't front the cost. Show the user a cost preview (`estimateWorkflow` from `@civitai/app-sdk` → calls `?whatif=true`) before submitting.
- **Scopes are bitmasks.** Request only what you need at consent time. For the standard image-generation demo: `AIServicesWrite | BuzzRead | UserRead`. Use the named constants from `@civitai/app-sdk/scopes`, not magic numbers.

## Patterns to avoid

- ❌ Putting `CIVITAI_CLIENT_SECRET` in any client-side bundle, manifest, or build artifact. It belongs in `.env` on the server side only.
- ❌ Putting `access_token` or `refresh_token` in `localStorage`, `sessionStorage`, or rendered HTML.
- ❌ Reimplementing the orchestrator fetch + body shape in each starter. Use `@civitai/app-sdk/orchestrator`'s `estimateWorkflow`, `submitWorkflow`, `getWorkflow`, `pollWorkflow`, and `buildTextToImageBody`.
- ❌ Adding Redis, Postgres, or any external session store. The starters are designed to deploy as a single static bundle + (for PWAs) a single edge function. Don't add stateful infra.
- ❌ Hardcoding the orchestrator URL or scope bitmask values. Use `@civitai/app-sdk`'s constants.
- ❌ Replacing the OAuth flow with a "just store an API key" shortcut. API keys spend *the key owner's* Buzz, not the end user's — that's the wrong tenant model for a third-party app.

## Where to extend

Each starter ships a deliberately minimal demo (login + balance + cost preview + one generation + display). When the user asks you to add features:

- **New API call against Civitai** → if it'll be reused across starters, add a helper next to `@civitai/app-sdk/src/orchestrator/` (or a new sibling module). Otherwise inline in the starter using `callOrchestrator` from `@civitai/app-sdk/orchestrator`.
- **New page / route** → follow the framework's idioms (App Router for `next-app`, `+page.svelte` for `sveltekit-app`, etc.). Keep auth gating consistent with the existing pattern in each starter.
- **Persistence (saved generations, user prefs)** → starters intentionally don't include a database. If the app needs persistence, suggest adding one (recommend the framework-native choice — Vercel KV, Cloudflare D1, etc.) but flag it as **net-new infra**.

## Repo layout

```
civitai-app-starters/
├── packages/
│   ├── civitai-app-sdk/         # shared OAuth + SDK glue + framework-agnostic blocks contract
│   ├── civitai-blocks-react/    # React hooks + iframe transport for Civitai Apps
│   ├── civitai-elements/        # light-DOM Lit custom elements (the design system's future)
│   └── civitai-elements-react/  # typed JSX intrinsics for the above — types only, no wrappers
└── starters/
    ├── next-app/                # Next.js 15 App Router (SSR)
    ├── sveltekit-app/           # SvelteKit 2 (SSR)
    ├── react-pwa/               # Vite + React 19 (SPA + Hono BFF)
    └── svelte-pwa/              # Vite + Svelte 5 (SPA + Hono BFF)
```

## The component story (in flight)

There are currently **three** ways to render a themed Civitai component, and
only one of them is where things are going:

- `@civitai/blocks-react/ui` (147 files across the fleet) and
  `@civitai/components-react` (32 files) publish **34 identical component names
  with drifted contracts** — `Select` is controlled in one and uncontrolled in
  the other, `Stack`'s `gap` means two different things, `Alert` derives `role`
  differently. Five of six audited apps import **both**, which is the hazard.
- `@civitai/elements` is the intended replacement: light-DOM Lit custom
  elements, one contract per component, form-associated inputs, Custom Elements
  Manifest as the source of truth for the React types and the CI API-surface
  gate. `@civitai/elements-react` carries its generated JSX types (React 19
  needs no wrapper components — measured, not assumed).

🔴 **Do not cite bundle size as the reason.** An earlier version of this section
said "one Button: 21.3 KB vs 52.5 KB measured". **Retracted.** Splitting
`@civitai/components`' stylesheet per component *inside the existing React
packages* — no new package, no Lit — gets the same Button to **13.5 KB**, which
beats the custom element by 37%. 95% of the 52.5 KB baseline is one monolithic
`export const` CSS string, and that has nothing to do with custom elements; the
element's JS is 4.6× larger. Numbers, method and the control:
`packages/civitai-elements/README.md` and `scripts/measure-bundle.mjs`.

The reasons that do survive measurement: one implementation instead of two,
real `<form>` participation via `ElementInternals`, and framework independence
across the React/Svelte/plain-HTML starters.

🔴 **Phase 1 has NOT yet reduced the duplication.** 33 of the 34 colliding names
still stand — only `Stack`'s `gap` drift is closed. Until more seams land,
#328's hazard is the motivation for this work, not something it has fixed.

Migration is **strangler**, not a cutover: the React packages keep working and
re-export from the elements one component at a time. The first seam is
`blocks-react/ui`'s `Stack`, whose existing tests are unchanged and green.

**When adding a new shared component, add it to `@civitai/elements`** — do not
add a 35th duplicated pair. Do not add an alias for a name that already exists
in either React package either: re-exporting `ButtonVariant` from a third place
makes #328 worse, not better. When fixing a bug in an existing component, check
whether the same bug exists in its twin.

## Releasing a new SDK version

`@civitai/app-sdk` ships via [changesets](https://github.com/changesets/changesets) + a GitHub Actions workflow with npm OIDC trusted publishing. The maintainer flow is a one-liner:

```bash
pnpm changeset      # describe the bump; commit the generated .changeset/*.md
```

Merge to `main` → review the auto-generated *Version Packages* PR → merge it → npm publish runs in CI with no token, no OTP. Full flow: [`RELEASING.md`](./RELEASING.md).

## See also

- Per-starter `AGENTS.md` files for stack-specific guidance.
- [`packages/civitai-app-sdk/README.md`](./packages/civitai-app-sdk/README.md) — full SDK API reference.
- [`packages/civitai-blocks-react/README.md`](./packages/civitai-blocks-react/README.md) — React hooks + iframe transport for Civitai Apps.
- [`RELEASING.md`](./RELEASING.md) — SDK publish + changeset workflow.
- [Civitai OAuth quickstart](https://developer.civitai.com/docs/oauth) — official upstream docs.
