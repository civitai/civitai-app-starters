# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) to
version and publish `@civitai/app-sdk`. The starter packages under
`starters/*` are private templates and are not published — they're
intentionally excluded in `config.json`.

## Day-to-day

When you change `packages/civitai-app-sdk/`:

```bash
pnpm changeset
```

Pick a bump type (patch / minor / major) and write a short summary —
this becomes the changelog entry. The resulting markdown file in
`.changeset/` gets committed alongside your code change.

A "patch" is right for bug fixes, "minor" for additive API, "major" for
breaking changes (renames, removals, signature changes).

## Release flow

On push to `main`, the `.github/workflows/release.yml` workflow runs
`changesets/action@v1`, which either:

- opens / updates a "Version Packages" PR that consumes pending
  changeset files and bumps the SDK version + `CHANGELOG.md`, or
- if such a PR has just been merged, publishes the SDK to npm via
  OIDC trusted publishing (no `NPM_TOKEN` required).

## Not publishing the starters

The starters intentionally aren't on npm — devs sparse-clone them via
`npx tiged`. Bumping their version would be cosmetic. They live under
the `ignore` list in `config.json`.
