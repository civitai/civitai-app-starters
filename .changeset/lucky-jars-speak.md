---
'@civitai/blocks-client': patch
---

The `buzz` and `orchestration` namespaces now say at the call site that no host
handler answers them yet. `BREAKING.md` has always recorded it, but nothing
reached a reader hovering `buzz.getAccounts()` — and the consequence is worse
than a rejection: request timeouts belong to the host, so a message it does not
implement means the promise never settles.

All ten affected functions carry an `@experimental` note naming the message, and
`check-host-parity` now fails both ways — a message in `AWAITING_HOST` with no
note, and a note for a message the host has since implemented.
