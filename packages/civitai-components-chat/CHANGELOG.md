# @civitai/components-chat

## 0.3.0

### Minor Changes

- 6d3d911: Chat replies use the viewer's free daily allowance (`X-Civitai-Tier: free`). Settings' Assistant choice gains Auto (free replies first, then Buzz; the default) and Free (free replies only; when used up a reply offers Continue with Buzz) next to Default (always Buzz), the configured models and Custom.

  The package no longer lists a "Smart" model by default; hosts add their own with `configureChat({ models })`.

- 7c4ac10: `<civitai-chat>` takes `commands`: a page adds its own slash commands (`{ usage, help, aliases?, run(arg, { send, compose, notify, conversationId }) }`), replaces a built-in by name or removes one with `null`, or builds the whole set from the built-ins with a function. Page commands show in suggestions, Tab completion and `/help`.
- 798337d: `configureChat({ name })` sets what the chat calls itself: the sidebar brand, the assistant's persona, posting messages and the conversation export's file name. It defaults to "Civitai Chat" (it said ChatCVT, the working name).

### Patch Changes

- 2559552: `<civitai-chat>` no longer calls `/api/v1/me` inside a civitai.com block. That route accepts an OAuth token but refuses the block-scoped one, so a block on the default token sent a request that failed on every mount and showed no name. In a block the chat now takes the viewer's name from the host (`app.viewer.username`), which needs no request and no consent. Outside a block it still asks `/me`, as before.
- 9887295: docs: the README listed "a block on civitai.com" as a plain way to sign the chat in, and by default it does not work

  The Signing in table offered `await initialize()` in a block, with the manifest asking for
  `ai:write:budgeted`, as one of three equal setups. The chat sends `app.getToken()` straight to the
  orchestrator (its chat model, its MCP and its workflow routes), and the token a block holds by
  default is the block-scoped one, which the orchestrator accepts on no route; `@civitai/sdk`'s own
  README says the same. So in a block with the default token every reply is refused.

  The README now says the chat needs an OAuth access token, links to `@civitai/sdk`'s README for when
  a block gets one, says nothing proxies the chat's own endpoints (its model and MCP), and says its generations then
  skip the controls the block workflow routes add.

  Prose only, no behaviour change. A patch release because the README ships in the package.

- Updated dependencies [13d004e]
- Updated dependencies [e174afd]
  - @civitai/components@0.9.3

## 0.2.0

### Minor Changes

- 1af1054: Panels: the assistant can build a set of controls for one kind of generation (`open_panel`) that the viewer runs as often as they like, straight on the orchestrator and without an assistant reply each time. It sees the panel's values and runs when asked for help, and changes it in place (`update_panel`). Panels use content-studios' input kinds and a `run_step`/`run_workflow` template, keep every version and the exact values of each run, and are saved with the conversation. Share copies a link that opens a copy of the panel in the viewer's own conversation (`openPanel()`, `holdSharedPanel()`, `panel-link-base`). `dock-panels` and `<civitai-chat-studio>` show a panel studio-style beside the chat. A panel's button can ask the assistant instead of running a generation (`run: { ask }`, `button`). Viewers can pick the assistant's model in Settings (`configureChat({ models })`, or a custom model id). Slash commands in the message box: `/clear`, `/model`, `/help`. Choices can stand for a block of inputs, and Adjust on a generation card turns it into a panel with the prompt and a priced model list. Tool calls render through views: `toolViews` and a page tool's `render` replace a call's card, and `activity` names what it is doing. Voice input: a microphone button streams the viewer's speech to a `liveTranscription` step so the words appear as they talk (phrase by phrase with `transcribe_audio` where audio worklets are missing), then puts the text in the message box or sends it.

## 0.1.1

### Patch Changes

- No source change. This records the version that is actually on the registry.

  `0.1.0` — this package's first-ever publish — FAILED in CI with
  `E404 Not Found - PUT https://registry.npmjs.org/@civitai%2fcomponents-chat`
  (release run 36747192297). Under npm OIDC trusted publishing that 404 means
  "unauthorized", and it is unavoidable on a first publish: a trusted publisher
  cannot be configured for a package the registry does not know yet, so there was
  nothing for the workflow's OIDC handshake to match. The other five packages in
  that run published normally — `changeset publish` continues past a failing
  package — so only this one was left behind.
  `0.1.1` was then published by hand from a maintainer's machine to bootstrap the
  name (npm user `devzacx`, 2026-09-30T18:01:58Z, no provenance attestations,
  unlike every other `@civitai/*` package), and the accompanying version bump was
  never committed.

  That left `main` permanently red: the tree said `0.1.0`, the registry held only
  `0.1.1`, so `pnpm assert:published` correctly reported
  `PUBLISH DID NOT HAPPEN — a package version in this tree is not on the registry.`
  on every push, blocking the release signal for every other package. Recording
  `0.1.1` here makes `changeset publish` skip the package as already-published and
  lets the assertion pass.

  🔴 **Still outstanding, and this bump does not fix it:** `@civitai/components-chat`
  has no GitHub Actions trusted publisher on npmjs.com. Until one is configured
  (owner `civitai`, repo `civitai-app-starters`, workflow `release.yml`,
  environment blank — the same trust the other six packages already have), the
  next changeset that bumps this package will fail to publish with the same E404.

## 0.1.0

### Minor Changes

- 407251d: New package: `<civitai-chat>`, a Civitai assistant as one element, the companion to `@civitai/components` for pages that want a chat that makes images, video and music on the viewer's Buzz. `@civitai/components-chat/civitai-chat/define` registers it; the agent loads lazily once the chat has a signed-in `AppClient`. A page hands over its own client (`app`) or lets the chat sign in on the first message (`signIn`, with `popupSignIn(auth)` built on `SignIn.signInWithPopup()`). Page tools, instructions, prompt, MCP switches, scope, layout and a welcome slot are the embedding API.

### Patch Changes

- Updated dependencies [c66ae73]
- Updated dependencies [38d0907]
  - @civitai/components@0.9.0
