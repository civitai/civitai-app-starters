---
"@civitai/app-sdk": minor
---

Add the `GET_VIEWER` → `VIEWER_RESULT` message pair to the `blocks` postMessage contract, mirroring the host `blocks.getMyViewer` bridge being added in parallel in civitai/civitai.

- **`GET_VIEWER` → `VIEWER_RESULT`** — the signed-in viewer self-read (`{}` → `{ viewer: BlockViewer }` | `{ error }` free-text). Token-bound: the host resolves the viewer from the block token and reads via `blocks.getMyViewer`; an anonymous / banned token comes back as the reply's free-text `error`.

New shared result type `BlockViewer` in `blocks/types.ts` (re-exported from `@civitai/app-sdk/blocks`): `{ id: number; username: string | null; status: 'active' | 'muted'; buzzBudget: number | null }`, documented as mirroring its civitai/civitai `blocks.getMyViewer` projection (PR #3152) with a "keep in lockstep" note. Distinct from the BLOCK_INIT-embedded `ViewerInfo` — `status` is the narrow spendable/mutable pair. NULLABILITY: `username` and `buzzBudget` are present-but-NULLABLE (the host returns `username: null` for a viewer with no handle, `buzzBudget: null` when the token lacks the budget claim), not omitted — consumers and the guard must accept `null` for both.

Follows the `GET_BUZZ_BALANCE` / `BUZZ_BALANCE_RESULT` value-or-error convention exactly.
