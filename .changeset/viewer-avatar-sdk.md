---
'@civitai/sdk': minor
---

**`ViewerInfo.image` (`ViewerImage`): the viewer's avatar on `app.viewer`.** The host sends it when the token carries `user:read:self`. `{ url, nsfwLevel }` is the avatar, `{ restricted: true }` means it's withheld by the app's maturity ceiling or unrated, and `null` means no avatar. Optional and additive.
