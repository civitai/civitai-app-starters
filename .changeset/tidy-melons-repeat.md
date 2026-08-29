---
'@civitai/blocks-react': patch
---

fix(blocks-react): normalize the `{ok, error}` reply validators so an error reply is always valid — six of them dropped `{requestId, error}` and hung the block to its request timeout
