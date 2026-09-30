---
'@civitai/components-chat': minor
---

New package: `<civitai-chat>`, a Civitai assistant as one element, the companion to `@civitai/components` for pages that want a chat that makes images, video and music on the viewer's Buzz. `@civitai/components-chat/civitai-chat/define` registers it; the agent loads lazily once the chat has a signed-in `AppClient`. A page hands over its own client (`app`) or lets the chat sign in on the first message (`signIn`, with `popupSignIn(auth)` built on `SignIn.signInWithPopup()`). Page tools, instructions, prompt, MCP switches, scope, layout and a welcome slot are the embedding API.
