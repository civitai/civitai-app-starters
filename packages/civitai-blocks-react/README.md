# `@civitai/blocks-react`

React hooks and iframe transport for [Civitai App Blocks](https://developer.civitai.com/docs/blocks).

Pairs with [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk)'s
`/blocks` subpath, which carries the framework-agnostic manifest, scope, and
`postMessage` contract. This package adds the transport that actually moves
bytes and the React hooks block authors call.

## Install

```bash
pnpm add @civitai/blocks-react @civitai/app-sdk react
```

`react` and `@civitai/app-sdk` are peer dependencies — bring them yourself so
your block app and the SDK share a single React tree.

## Quick start

```tsx
import { useBlockContext, useBuzzWorkflow } from '@civitai/blocks-react';

export function App() {
  const { ready, context, viewer } = useBlockContext();
  const { estimate, submit, status, result } = useBuzzWorkflow();

  if (!ready) return <div>Loading…</div>;
  return (
    <div>
      <p>Block for model {context.modelId} ({viewer.username})</p>
      <button onClick={() => submit({ prompt: 'a cat' })}>Generate</button>
      {status === 'done' && result?.imageUrls?.map((u) => <img key={u} src={u} />)}
    </div>
  );
}
```

## What lives where

- [`@civitai/app-sdk/blocks`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks): manifest types, `defineBlock`, `BLOCK_SCOPES`, `postMessage` protocol, JSON schema.
- This package: `IframeTransport`, transport detector, and the eight React hooks (`useBlockContext`, `useBlockToken`, `useBlockSettings`, `useBuzzWorkflow`, `useBlockResize`, `useBuzzPurchase`, `useCivitaiNavigate`, `useBlockAnalytics`).

Architecture and contribution notes live in the [in-repo `AGENTS.md`](https://github.com/civitai/civitai-app-starters/blob/main/packages/civitai-blocks-react/AGENTS.md) (not shipped in the published tarball).

## License

MIT — see [`LICENSE`](../../LICENSE).
