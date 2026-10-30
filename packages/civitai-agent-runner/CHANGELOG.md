# @civitai/agent-runner

## 0.1.1

### Patch Changes

- 6cbc7b8: A reply whose tools are built again mid-reply (components-chat's `reopenTools`) is handed its finished steps when they are opened (`history.current`), and every set of tools opened is closed exactly once: the set before a rebuild as the new one replaces it, and a set that was being opened when the reply was stopped as soon as it arrives.

## 0.1.0

### Minor Changes

- d559b39: New package: `@civitai/agent-runner`, the durable runner behind `<civitai-chat>`'s remote mode. Replies run as DBOS workflows on Postgres and are served over the chat's runner protocol v1 (start, look up, stop, stop by key, patch, events over SSE). A deployment plugs in its own authentication, run-grant verification, grant store, conversation store, model and tools through the interfaces the package exports. The workflow names, queue and application version (`reply-1`) are the ones Civitai's assistant runner records, so runs it started can be recovered by this package. A run grant must carry a boolean `preview` flag: a grant without one is refused (fail closed), `preview: false` is a run grant and `preview: true` a preview grant.
