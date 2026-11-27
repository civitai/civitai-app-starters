---
'@civitai/app-sdk': minor
---

**The viewer's avatar: `ViewerInfo.image` and `BlockViewer.image` (`ViewerImage`).** `{ url, nsfwLevel }` is a ready-to-render CDN url plus the avatar's rating. `{ restricted: true }` means the viewer has an avatar this app may not show: it's rated above the app's maturity ceiling, or not rated yet. `null` means no avatar. The platform sends the field only when the token carries `user:read:self`. It's optional, so a host that predates it omits it.
