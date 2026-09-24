---
'@civitai/components': minor
'@civitai/components-react': minor
---

`<civitai-video>` and `<civitai-audio>`, siblings of `<civitai-image>` that
follow HTML's own three media elements, and the states a generated file goes
through, now on all three:

- `pending` while the file is still being made: a loader, and nothing requested.
- `blocked` when it is withheld from the viewer: the `blocked` slot says why,
  and the file is never requested.
- `fallback` when it fails to load, which is how an expired signed URL shows up;
  listen for `error` to hand it a fresh `src`.

`status` gains `blocked` alongside `loading`, `loaded` and `error`, and `load`
and `error` still do not bubble, matching the media events they stand in for.

`openable` turns an image, or a `preview` video, into a real button that emits
`open`, so a gallery opens a viewer from the keyboard as well as a click. A
`preview` video plays muted and looping, without controls, while hovered or
focused; any other video keeps its native controls. `--civitai-media-max-height`
caps the height of an image or a video.

`<civitai-image>` is unchanged unless these are used: same parts, events and
look, and its parity test against the legacy markup still passes.

React: `CivitaiVideo` (`onVideoLoad`, `onVideoError`, `onOpen`), `CivitaiAudio`
(`onAudioLoad`, `onAudioError`), and `onOpen` on `CivitaiImage`.
