# `@civitai/blocks-cli` — DEPRECATED

> ⚠️ **Deprecated** — superseded by the Civitai CLI (Go):
> **[github.com/civitai/cli](https://github.com/civitai/cli)**. This package is no
> longer published. Install the Go CLI with
> `go install github.com/civitai/cli/cmd/civitai@latest` (or grab a
> [prebuilt binary](https://github.com/civitai/cli/releases)).

`@civitai/blocks-cli` installed a `civitai` binary (`civitai init` / `civitai dev`)
that **collides** with the new Go `civitai` CLI — which is a superset, covering
scaffolding, validation, submission, and auth under a single `civitai app …`
command group (the local dev loop is the scaffolded project's own
`npm run dev:harness` / `npm run dev:live`). To avoid the binary-name collision
and the divergent UX, this npm CLI has been retired in favor of the Go CLI.

The runtime packages it sat beside — **`@civitai/app-sdk`** and
**`@civitai/blocks-react`** — are unaffected and continue to ship.

## Command mapping (old → new)

| `@civitai/blocks-cli` (old) | Go `civitai` CLI (new) |
|---|---|
| `civitai init <name>` | `civitai app init <name>` (or `civitai app create <name>`) |
| `civitai dev` | _(the scaffolded project's own `npm run dev:harness` / `npm run dev:live`)_ |
| _(none — local-only preflight)_ | `civitai app validate` |
| _(none — submit was the `/apps/submit` web flow)_ | `civitai app submit` |
| _(none)_ | `civitai login` |

## Installing the Go CLI

```bash
# Go install (Go 1.25+)
go install github.com/civitai/cli/cmd/civitai@latest
```

Or download a prebuilt binary for your OS/arch from the
[GitHub Releases](https://github.com/civitai/cli/releases) page. (A Homebrew tap
is coming soon — `brew install civitai/tap/civitai` is not live yet.)

Then verify and start:

```bash
civitai version
civitai login        # browser device login (or `--token <key>`)
civitai app init my-app
```

## License

MIT
