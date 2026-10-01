---
'@civitai/blocks-react': patch
'@civitai/app-sdk': patch
---

`useCivitaiNavigate` no longer tells authors to declare a sandbox token the host strips.

civitai.com derives a block's iframe `sandbox` attribute by filtering the manifest's
declared tokens through a fixed allowlist (`ALLOWED_SANDBOX_TOKENS` in
`src/components/AppBlocks/sandbox.ts`). That filter is tier-independent —
`trustTier` only decides whether `allow-same-origin` is *added* — and
`allow-popups-to-escape-sandbox` is not in the allowlist, so it is dropped for
every block at every trust tier. Both the `useCivitaiNavigate` README entry and
its JSDoc said `'new_tab'` "requires" that token, and the block starter declared
it, so every scaffolded app inherited a declaration that could not do anything.

The docs now state only what is verifiable: the hook sends a `NAVIGATE` message,
`target` is a request rather than a guarantee, the host is the authority on how it
acts on one, and nothing in the manifest enables `'new_tab'`. The starter manifest
drops the token (and `allow-popups`, which it never used), leaving
`"allow-scripts allow-forms"` — the same value all six shipped examples already
declare. `@civitai/app-sdk`'s `SCHEMA_DIVERGENCES['iframe.sandbox']` prose stops
citing the starter as its worked example, since the starter no longer declares it.

A new deterministic guard (`tests/guards/manifest-sandbox-tokens.test.mjs`) pins all
of it: every manifest and documented `"sandbox"` literal must declare only grantable
tokens, and the set of files naming a silently-stripped token is an asserted ledger
that fails when it grows *or* shrinks.
