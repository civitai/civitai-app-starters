# `@civitai/blocks-cli` — DEPRECATED

> **This package is deprecated and no longer published.** It has been superseded
> by the Go **`civitai` CLI** at **[github.com/civitai/cli](https://github.com/civitai/cli)**.

`@civitai/blocks-cli` installed a `civitai` binary (`civitai init` / `civitai dev`)
that **collides** with the new Go `civitai` CLI — which is a superset, covering
scaffolding, local dev, validation, submission, and auth under a single
`civitai app …` command group. To avoid the binary-name collision and the
divergent UX, this npm CLI has been retired in favor of the Go CLI.

The runtime packages it sat beside — **`@civitai/app-sdk`** and
**`@civitai/blocks-react`** — are unaffected and continue to ship.

## Command mapping (old → new)

| `@civitai/blocks-cli` (old) | Go `civitai` CLI (new) |
|---|---|
| `civitai init <name>` | `civitai app init <name>` |
| `civitai dev` | `civitai app dev` |
| _(none — local-only preflight)_ | `civitai app validate` |
| _(none — submit was the `/apps/submit` web flow)_ | `civitai app submit` |
| _(none)_ | `civitai login` |

## Installing the Go CLI

> **Note:** the Go `civitai` CLI repo and its Homebrew tap are currently
> **private** — there is no public release yet. The public
> `brew install civitai/tap/civitai` instruction is **pending the CLI going
> public**. Until then, internal / moderator users build from source:
>
> ```bash
> git clone https://github.com/civitai/cli
> cd cli && go build -o civitai . && ./civitai app --help
> ```

## License

MIT
