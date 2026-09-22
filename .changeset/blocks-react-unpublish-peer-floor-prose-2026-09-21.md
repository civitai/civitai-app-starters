---
'@civitai/blocks-react': patch
---

Stop shipping maintainer post-mortem prose in the published artifact.

`package.json`'s `comment-peerDependencies` array was 142 lines — 10,574 B of a
12,734 B `package.json`, 83% of a file npm downloads on every install (#375).
The prose moved to `PEER_FLOOR.md`, which this package's `files` field excludes
from the tarball; the key stays as a one-line pointer, and a guard caps the total
serialized size of every `comment*` key at 500 B so it cannot regrow. The
published `package.json` drops from 12,734 B to 2,429 B.

`README.md`'s version-compatibility table also asserted a current
`peerDependencies` floor (`>=0.29.0 <1.0.0`) that `package.json` has contradicted
since #309/#317/#344/#371 moved it to `>=0.49.0 <1.0.0`, together with a "npm
will not warn you" claim that is now false in the other direction (#383). Both
rows are scoped to the versions they describe; the README no longer states a
current floor at all — `package.json` carries it.

No behaviour, API or peer-range change.
