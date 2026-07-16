---
"@civitai/blocks-react": minor
---

Add the missing trust-boundary validators, hook docs, and dev-harness coverage the last audit found — user-visible robustness, no message-contract change (the `@civitai/app-sdk` peer stays `^0.23.0`).

- **Transport validators for 15 reply types that previously crossed the boundary unchecked** (`payloadValidatorFor` returned `null` for them, so a malformed host reply resolved the hook with `undefined`-typed-as-`number`/`string` — silent corruption, no throw, no timeout). Now wired into the same drop-on-malformed path as the already-validated bridges (a bad reply is dropped → the request rejects at its timeout instead of returning corrupt data):
  - the 5 `APP_STORAGE_*_RESULT` reads (`GET`/`SET`/`DELETE`/`LIST`/`QUOTA`) behind `useAppStorage`;
  - the 7 `SHARED_*_RESULT` replies (`LIST`/`GET_COUNT`/`GET_COUNTS`/`APPEND`/`VOTE`/`UNVOTE`/`WITHDRAW`) behind `useSharedStorage` — closes the `getCount`/`getCounts`/`append`/`vote`/`unvote`/`list` silent-corrupt-return hole;
  - `CHECKPOINT_PICKER_RESULT`, `RESOURCE_PICKER_RESULT`, and `USER_CHECKPOINT_SET` — the money-adjacent `versionId` a picker hands to a workflow body is now shape-checked (positive integer) at the boundary. Each validator matches the host's real reply shape (dates are ISO strings; error paths carry zeroed success fields; pickers omit `selected` on dismiss; nullish is accepted where the host sends it).
- **README sections for 8 previously-undocumented exported hooks**: `useSharedStorage`, `useResourcePicker`, `useImageUpload`, `useGenerationResources`, `useRequestSignIn`, `useRequestConsent`, `useDomainMaturity`, and `SfwGate` — each with a `typecheck:readme`-verified example.
- **Dev-harness fidelity fixes** (a hook no longer hangs against a harness that models the protocol): `createMockHost` now answers `SET_USER_CHECKPOINT` (`useCheckpointPicker().persist()` no longer hangs); `createLiveHost` now forwards `OPEN_IMAGE_UPLOAD` (honest dismiss — no headless upload contract) and all eight `SHARED_*` bridges to `apps.shared.*` (`useSharedStorage` no longer hangs in `dev:live`).
- **Smaller fixes**: `useGenerationResources` gained an `AbortController` + timeout + unmount-cancel (the only fetch path that could hang indefinitely); `useBlockToken`'s refresh-dedup is now keyed by `blockInstanceId` (a latent inline-mode v2 bug where one instance's token refresh coalesced onto another's).
