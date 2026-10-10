---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**`useResourcePicker()` can collect several LoRAs in one picker session (#580).** Pass `multiple: { max }` and `open` resolves with a **list** of the picked resources, in the order the viewer picked them, instead of a single resource: `const loras = await open({ resourceType: 'LORA', multiple: { max: 3 } })`. Dismissing the picker resolves with `[]`. Each entry is the same `BlockResourceInfo` a single pick returns, and every id is still re-validated at estimate and submit.

- 🔴 **RELEASE HOLD: do not release this until civitai/civitai#5687 is merged and deployed to civitai.com.** A host that predates it ignores `multiple` and opens the single-pick picker. `open` still resolves with a list there, of the one LoRA the viewer picked or `[]`, so nothing breaks, but the viewer cannot pick several until the host ships.
- **Without `multiple`, nothing changes.** `open` sends the same message and resolves with one resource or `null`, exactly as before.
- **LoRA only.** `multiple` with `resourceType: 'Checkpoint'` is a type error, and at runtime `open` rejects before sending anything. It is never treated as a single pick.
- **`max` is a whole number of at least 1, capped at 5**, the cap on `additionalResources`. A larger value is clamped to 5; `0`, a negative number or a fraction makes `open` reject. The cap is exported as `RESOURCE_PICKER_MULTIPLE_MAX`. The host applies the same clamp and the same refusals.
- `baseModelGroup` works with `multiple` as it does for a single pick.
- If the host refuses a `multiple` request, `open` rejects with the host's message.
- New exports from `@civitai/blocks-react`: `RESOURCE_PICKER_MULTIPLE_MAX` and the types `ResourcePickerOpenOptions` and `ResourcePickerMultiple`.
- `@civitai/app-sdk`: the `OPEN_RESOURCE_PICKER` payload type gains `multiple?: { max: number }`, and `RESOURCE_PICKER_RESULT` gains `selectedResources?: BlockResourceInfo[]` and `error?: string`. All optional, so existing callers are unchanged. A single-pick reply still carries only `selected`.
- The reply validator checks every entry of `selectedResources` the way it checks `selected`. A list with one malformed entry is dropped whole.
- **Mock host (`createMockHost` / `Harness`, `@civitai/blocks-react/testing`):** a `multiple` request resolves with two curated LoRAs by default, cut to the request's `max`. New option `cannedMultiPicks` sets the list; `null` or `[]` simulates a dismissed picker, and `cannedPicks: { LORA: null }` dismisses both pick modes. The mock answers a raw `multiple` + Checkpoint request, or an invalid `max`, with the host's error.
- **`dev:live`:** the in-harness picker has a multi-select mode. A card click stages or un-stages a LoRA, and the "Add" button sends the staged list in the order it was staged.
