# @civitai/components-chat

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
