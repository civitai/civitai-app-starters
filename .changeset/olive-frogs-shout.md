---
'@civitai/components': patch
---

Add a cross-engine contract suite and a capability probe.

The elements rest on a handful of platform features that do not degrade — a
browser missing `ElementInternals` or constructable stylesheets does not render
a worse button, it renders a broken one. `test:contract` probes each feature
directly and names what breaks without it, then exercises the cross-engine
surface: upgrade, token inheritance across the shadow boundary, form
association, `change` escaping the shadow root, and `::part` reachability.

It runs on chromium, firefox and webkit, as an **advisory** CI job. The cost
there is the browser install rather than the tests — `playwright install
--with-deps` was measured wedging for over two hours on one commit — so three
engines must not be able to block a PR. The chromium half already runs inside
the required job, so nothing is checked only in the advisory one.

Also guards against `:host-context()`, which has never shipped in Firefox. A
runtime probe cannot see that we used it, only that a browser lacks it, so the
guard reads the source instead.
