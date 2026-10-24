---
'@civitai/sdk': patch
---

Docs only. `createFakeStorage`'s default scanner models the server's enforced moderation: a hit is refused `content_rejected` and a scanner outage `moderation_unavailable`. The host picks each app's moderation mode for shared data, and enforce is not its default. Where it runs in shadow (scanned after the write) or is off, neither a hit nor an outage refuses a write. The README and the fake's module comment now say so, and that `moderate: () => null` is what such an app sees. The vendored storage contract is re-vendored to the served copy, whose `conventions.note` now says its moderation cases describe an app whose shared-data moderation is enforced.
