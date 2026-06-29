# Releasing packages

This repo publishes two packages to npm:

- [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk) — framework-agnostic OAuth + orchestrator + blocks contract.
- [`@civitai/blocks-react`](https://www.npmjs.com/package/@civitai/blocks-react) — React hooks + iframe transport that pair with `@civitai/app-sdk/blocks`.

The four starter templates under `starters/*` are private and aren't on npm — external devs `tiged` them directly from GitHub.

Scaffolding/dev is handled by the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)) — the old `@civitai/blocks-cli` npm scaffolder it replaced stays published-but-deprecated on npm but is no longer part of this repo.

The release pipeline runs on [changesets](https://github.com/changesets/changesets) plus a GitHub Actions workflow ([`.github/workflows/release.yml`](./.github/workflows/release.yml)) authenticated via npm **OIDC trusted publishing** — no `NPM_TOKEN` secret, no manual `npm login`, no OTP after the initial bootstrap.

## TL;DR — the happy path

```bash
# 1. Make a change in packages/civitai-app-sdk/
# 2. Author a changeset describing the bump:
pnpm changeset

# 3. Commit the generated .changeset/<slug>.md alongside your code change.
# 4. Open a PR. CI runs typecheck + build + vitest on the SDK.
# 5. Merge to main. The Release workflow opens (or updates) a
#    "Version Packages" PR that bumps the SDK version + updates
#    CHANGELOG.md.
# 6. Review the Version Packages PR; merge it.
# 7. The Release workflow publishes to npm via OIDC.
```

That's it. The Version Packages PR is the only thing a maintainer reviews per release — and it shows exactly what version + changelog will ship.

## When to author a changeset

For any change to a published package — `packages/civitai-app-sdk/src/**` or `packages/civitai-blocks-react/src/**`. A single changeset may bump both packages; pick the appropriate level for each. Pick the bump type:

- **`patch`** — bug fix, internal refactor, doc-only tweak that affects the published bundle. No API shape change.
- **`minor`** — new exported function, new optional argument, new subpath export, looser input acceptance. **Adding API.**
- **`major`** — rename, removal, signature change, behavior change that existing callers will notice. **Breaking.**

A starter-only change (no SDK touch) does not need a changeset. The starter `package.json` files are `ignore`'d in `.changeset/config.json`.

## Previewing what's pending

```bash
pnpm changeset status
```

Lists every `.changeset/*.md` waiting to be consumed, plus the bump each implies. Run this before merging the Version Packages PR to sanity-check.

## What the release workflow actually does

On every push to `main`, [`changesets/action@v1`](https://github.com/changesets/changesets-action) does one of two things:

1. **Pending changesets exist** → open / refresh a PR titled `chore(release): version @civitai/app-sdk`. The PR's diff applies the version bumps + CHANGELOG entries that `changeset version` produces.

2. **No pending changesets** (i.e. the Version Packages PR was just merged) → run `pnpm release`, which is `pnpm -r --filter "./packages/*" build && changeset publish`. The publish step calls `npm publish` from each package directory whose version changed; npm detects it's running in GitHub Actions with `id-token: write` and uses **OIDC trusted publishing** to authenticate against the trust configured on each package's npm page (`access`). **Every publishable package must be in the `pnpm -r --filter "./packages/*" build` set** — `changeset publish` does not compile, so a package whose `dist/` isn't fresh will publish with stale or missing output.

No `NPM_TOKEN`. No 2FA prompt. The deploy completes in ~90 seconds.

## Bootstrapping the OIDC trust (one-time, per package)

Done for `@civitai/app-sdk` as of `0.1.0`. **Must be repeated for every newly-published package** — including `@civitai/blocks-react` before its first OIDC publish. For reference / disaster recovery:

1. Log in to npmjs.com as a `@civitai` org maintainer.
2. Go to the package page → **Settings** → **Trusted Publishers** → **Add publisher**.
3. Choose **GitHub Actions**, then fill:
   - Repository owner: `civitai`
   - Repository: `civitai-app-starters`
   - Workflow file: `release.yml`
   - Environment: *(blank)*

After this, subsequent publishes from the configured workflow auth via OIDC. Until the first OIDC publish for a package succeeds, npm history retains whatever bootstrap publisher created the initial release.

## Emergency manual publish

If the workflow is broken and you need to ship right now (substitute the package name as needed):

```bash
# from packages/<package>/
npm version <patch|minor|major> --no-git-tag-version    # or set the version explicitly
pnpm --filter <package-name> build
npm publish --access public --otp=<your-otp>            # legacy token + 2FA
# commit version bump + CHANGELOG manually, then push
```

Prefer the workflow path — it's the documented one and won't drift the CHANGELOG out of sync with the published tarball.

## Workflows touched by a release

- `.github/workflows/ci.yml` — runs typecheck + build per starter + SDK vitest on every PR + push.
- `.github/workflows/release.yml` — opens Version Packages PR / publishes on push to main.

If you change the workflow, do it in a separate PR — `changesets/action@v1` reads the file from `main`, so a workflow change paired with a changeset can race itself.

## See also

- [`.changeset/README.md`](./.changeset/README.md) — quick day-to-day reference for changeset commands.
- [`packages/civitai-app-sdk/CHANGELOG.md`](./packages/civitai-app-sdk/CHANGELOG.md) — full release history.
- [changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md) — upstream.
- [npm OIDC trusted publishing docs](https://docs.npmjs.com/trusted-publishers).
