---
'@civitai/sdk': minor
---

`SignIn.signInWithPopup()` signs the viewer in with Civitai in a popup, so a page that must not be navigated away from (an embedded chat, an editor) keeps its state. The popup returns to `redirectUri`, whose `createSignIn()` hands the result back over a same-origin `BroadcastChannel` and closes the popup. `SignInError` gains `code` (`'popup-blocked'`, `'canceled'`); an `AbortSignal` cancels. Additive: `signIn()` and the redirect flow are unchanged.
