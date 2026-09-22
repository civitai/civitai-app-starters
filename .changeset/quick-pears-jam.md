---
'@civitai/components': patch
---

Make every entry point importable with no DOM. `civitai-tooltip`, `civitai-tabs`
and `civitai-toast-region` subclass `HTMLElement` directly, and a class body is
evaluated at import — so `import '@civitai/components/register'` threw
`ReferenceError: HTMLElement is not defined` in Node and took down any
server-rendered app. Registration already no-opped without `customElements`;
the class declaration did not. A test now imports all 34 entry points with no
DOM present.
