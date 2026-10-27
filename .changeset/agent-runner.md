---
'@civitai/agent-runner': minor
---

New package: `@civitai/agent-runner`, the durable runner behind `<civitai-chat>`'s remote mode. Replies run as DBOS workflows on Postgres and are served over the chat's runner protocol v1 (start, look up, stop, stop by key, patch, events over SSE). A deployment plugs in its own authentication, run-grant verification, grant store, conversation store, model and tools through the interfaces the package exports. The workflow names, queue and application version (`reply-1`) are the ones Civitai's assistant runner records, so runs it started can be recovered by this package. A run grant must carry a boolean `preview` flag: a grant without one is refused (fail closed), `preview: false` is a run grant and `preview: true` a preview grant.
