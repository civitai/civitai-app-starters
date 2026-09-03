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

## 🔴 Why every `@civitai/*` package must be in the root `pnpm.overrides`

The starters pin **published caret ranges** (`"@civitai/theme": "^0.2.1"`), not
`workspace:*`, because they are copied out of this repo verbatim by
`npx tiged civitai/civitai-app-starters/starters/<name> my-app`. Nothing
rewrites the deps on the way out, so a `workspace:` protocol there produces a
scaffolded project whose `npm install` fails immediately. That was tried and
reverted in `2a453e6` — **do not re-introduce it.**

`ignore` in `.changeset/config.json` does **not** protect those pins. It only
suppresses *versioning the starter itself*; changesets still rewrites the
dependency ranges of every workspace dependent. So the Version Packages PR asks
the starters for versions that **do not exist on npm yet**, and without an
override that is a hard deadlock:

- `pnpm install --lockfile-only` → `ERR_PNPM_NO_MATCHING_VERSION` ("The latest
  release of `@civitai/theme` is 0.2.0") — the lockfile *cannot* be regenerated
  before publish;
- so `pnpm-lock.yaml` stays stale and every required check's
  `pnpm install --frozen-lockfile` → `ERR_PNPM_OUTDATED_LOCKFILE`;
- so the Version PR can never go green → never merge → never publish → the
  versions never come into existence.

A `pnpm.overrides` entry breaks the cycle without touching the published pins:
pnpm applies the override **before** recording the lockfile importer entry, so
the lockfile reads `specifier: workspace:*` and does **not** churn when
changesets bumps the caret. The caret in `package.json` is still what a
`tiged`'d copy sees.

> Note: `linkWorkspacePackages` is *not* a substitute — measured, not assumed.
> Spelled so that pnpm honours it, it changes what a specifier **resolves to**
> (`version: link:../../packages/civitai-theme`) but leaves the **specifier**
> itself as the caret (`specifier: ^0.2.0`), so `changeset version` bumping the
> caret still churns the lockfile and still breaks `--frozen-lockfile` on the
> Version PR. Only an override pins the recorded specifier. The full four-variant
> measurement — including which spellings pnpm actually reads — is in the comment
> block at the top of `pnpm-workspace.yaml`.

**When adding a new first-party `@civitai/*` package that a starter depends on,
add it to `pnpm.overrides` in the same PR.** Enforced by
`scripts/check-starter-workspace-overrides.mjs`, which runs in the required
`Starter` CI job *before* the install so it fails with an actionable message
instead of the cryptic `ERR_PNPM_OUTDATED_LOCKFILE`. That guard also hard-blocks
re-introducing the `workspace:` protocol into a tiged-consumed starter (the
`2a453e6` regression) and asserts a floor on how many pins it covers, so the
regression cannot come back as a silent drop in coverage.

Both guards are unit-tested — `tests/guards/*.test.mjs`, run by `pnpm
test:guards` and by the required `Starter` CI job.

## Previewing what's pending

```bash
pnpm changeset status
```

Lists every `.changeset/*.md` waiting to be consumed, plus the bump each implies. Run this before merging the Version Packages PR to sanity-check.

## What the release workflow actually does

On every push to `main`, [`changesets/action`](https://github.com/changesets/changesets-action) — SHA-pinned to `a45c4d5` (v1.9.0); see `.github/workflows/release.yml` — does one of two things:

1. **Pending changesets exist** → open / refresh a PR titled `chore(release): version @civitai/app-sdk`. The PR's diff applies the version bumps + CHANGELOG entries that `changeset version` produces.

2. **No pending changesets** (i.e. the Version Packages PR was just merged) → run `pnpm release`, which is `pnpm -r --filter "./packages/*" build && changeset publish`. The publish step calls `npm publish` from each package directory whose version changed; npm detects it's running in GitHub Actions with `id-token: write` and uses **OIDC trusted publishing** to authenticate against the trust configured on each package's npm page (`access`). **Every publishable package must be in the `pnpm -r --filter "./packages/*" build` set** — `changeset publish` does not compile, so a package whose `dist/` isn't fresh will publish with stale or missing output.

No `NPM_TOKEN`. No 2FA prompt. The deploy completes in ~90 seconds.

## 🔴 Staged publishing — how a release goes half-live, and why re-running is a dead end

**npm staged publishing is enabled on at least `@civitai/components`.** It exists so an
automated workflow can put a version into the registry without a 2FA prompt, leaving a
human to supply proof-of-presence later. `npm help stage`: a staged version sits in the
registry *"in a state where it's not available for public access"*.

**The divert is silent and it reports success.** Measured on release run `33785932215`
attempt 1 (2026-09-03): `changeset publish` printed

```
🦋  success packages published successfully:
🦋  @civitai/blocks-react@0.45.1
🦋  @civitai/components@0.4.1
🦋  @civitai/components-react@0.4.1
🦋  @civitai/theme@0.3.1
```

and `changesets/action` pushed all four git tags — while the registry only ever held two
of them (`theme@0.3.1` and `components-react@0.4.1`, both at `17:41:28Z`). `pnpm publish`
got a 2xx for `@civitai/components@0.4.1`; the registry staged it. Nothing in the tool
chain can see the difference. **`pnpm assert:published` is the only thing that caught it**,
on both 2026-09-02 and 2026-09-03.

**Then it deadlocks.** Staged and published versions share one semver index, so the slot
is taken. Attempt 2 of the same run:

```
npm error 409 Conflict - PUT https://registry.npmjs.org/@civitai%2fcomponents
  - Cannot publish over previously staged version "0.4.1".
```

Every later re-run gets the same, and so does a manual `npm publish`. **Re-running the
release workflow cannot fix a staged version** — only a human with 2FA can:

```bash
npm stage list @civitai/components      # find the stage id   (needs auth, no 2FA)
npm stage approve <stage-id>            # publish it          (2FA)
npm stage reject  <stage-id>            # free the slot       (2FA)
```

On 2026-09-03 `components@0.4.1` appeared at `17:45:38Z` — four minutes after the E409 —
when a human approved it.

### Why the half-live window breaks consumers

`pnpm` rewrites `workspace:*` to an **exact** version when it packs, so the published
`@civitai/blocks-react@0.45.1` requires `@civitai/components@0.4.1` to the digit (confirm
with `npm view @civitai/blocks-react@0.45.1 dependencies`). A dependent going live while
its dependency is staged therefore makes

```
npm install @civitai/blocks-react     # ETARGET — no matching version for @civitai/components@0.4.1
```

fail for every block author, with `latest` already moved. That happened twice, 2026-09-02
and 2026-09-03, ~15 minutes each time.

### 🔴 Approve in DEPENDENCY ORDER

`npm stage approve` takes **one stage id at a time** and each approval publishes
immediately, so there is no atomic batch — approval is inherently sequential. What removes
the consumer-facing window is not speed, it is **order**: approve a package only after
everything it depends on is live. Then every package that is visible at any instant has
all of its dependencies visible too.

```
1. @civitai/theme             (no first-party deps)
2. @civitai/components        (-> theme)
3. @civitai/components-react  (-> theme, components)
4. @civitai/blocks-react      (-> theme, components)
—  @civitai/app-sdk           independent; app-sdk is a PEER dep of blocks-react, any order
```

Re-derive rather than trusting this list — it is the `dependencies` block of each
`packages/*/package.json`, and a new package will not be in it.

### Making a release stage ALL five instead of some

The goal — *stage everything, publish nothing, approve as one batch* — **cannot be reached
from this repo.** Two measured reasons:

- `@changesets/cli` (2.31.0, the pinned version) has **no stage mode**: `changeset publish`
  hardcodes `pnpm publish` with `--access`/`--tag`/`--no-git-checks`/`--json`, and the
  string `stage` does not appear in its dist at all. `changesets/action`'s `publish:` input
  runs whatever command you give it, so a stage-only flow means replacing `changeset
  publish` wholesale — its already-published skipping, its git tags, and the `New tag:`
  stdout lines the action parses to create GitHub Releases.
- `npm stage publish` is `npm publish` with a flag (`lib/commands/stage/publish.js` extends
  `Publish` with `static stage = true`), and **npm does not rewrite the `workspace:`
  protocol** — this is a pnpm workspace, invisible to npm. Measured: `npm pack` on
  `packages/civitai-components` produces a tarball whose manifest still reads
  `"@civitai/theme": "workspace:*"`, which no consumer can install. Staging correctly would
  mean `pnpm pack` → `npm stage publish <tarball>` per package, by hand.

**The lever is on npmjs.com, not here.** Uniform staging is a per-package registry
setting: give every one of the five packages the same trusted-publisher / package-access
configuration that `@civitai/components` already has (see `npm help stage` → *Trust
Relationship Permissions*, `npm trust <provider> --allow-stage-publish` /
`--allow-publish`). `changeset publish` then stages all five with no code change at all —
it already does exactly that for `components`, transparently.

⚠️ **Doing that has a CI consequence, decide it deliberately.** `pnpm assert:published`
asserts every version in the tree is *published*. If a release stages all five, that step
fails by design until a human approves the batch, and it **cannot** verify the staged half
itself: an OIDC short-lived token cannot run `npm stage` subcommands (only `npm stage
publish` and `npm publish`). So the choice is between a release run that is red-until-
approved (honest: the release genuinely is not finished) and loosening the guard that is
currently the only thing detecting a partial release. Do not loosen it by accident.

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

If you change the workflow, do it in a separate PR — `changesets/action` reads the file from `main`, so a workflow change paired with a changeset can race itself.

## See also

- [`.changeset/README.md`](./.changeset/README.md) — quick day-to-day reference for changeset commands.
- [`packages/civitai-app-sdk/CHANGELOG.md`](./packages/civitai-app-sdk/CHANGELOG.md) — full release history.
- [changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md) — upstream.
- [npm OIDC trusted publishing docs](https://docs.npmjs.com/trusted-publishers).
