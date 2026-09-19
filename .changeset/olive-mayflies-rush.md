---
'@civitai/components-react': minor
---

React bindings for all 32 elements, built on `@lit/react`'s `createComponent`
instead of hand-written wrappers. It derives the props AND their types from the
element class, forwards refs to the element instance, and always assigns
properties rather than attributes — which is the React 19 behaviour the previous
wrappers had to work around by hand.

Each binding is its own module, so importing `@civitai/components-react/elements/civitai-button`
reaches that element and nothing else; the `./elements` barrel registers all of
them and is the convenient-but-larger path.

Breaking within this unreleased entry point: the wrappers are named after their
tags (`CivitaiButton`, not `ButtonElement`) and handlers receive the DOM Event
rather than an extracted value — `onChange={(e) => e.target.value}`,
`onVote={(e) => e.detail}`.
