---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**A price quote now itemises the app fee: `cost.authorFee` (civitai/civitai-app-starters#579).** `BlockWorkflowSnapshot['cost']` was `{ total }`, and `total` includes the app author's per-generation fee, so an app could not show "generation X + app fee Y". `cost` gains an optional `authorFee`: the part of `total` that is the fee, in whole Buzz. `total` keeps its meaning and value, so an app that never reads the new field is unaffected.

- 🔴 **RELEASE HOLD: do not release this until civitai/civitai#5688 is merged and deployed to civitai.com.** The field is sent by the host. Against a host that predates that change `cost.authorFee` is **absent** on every reply and `total` is exactly what it is today, so nothing breaks, but the documented field would not appear.
- **A number** on the `estimate()` result for a `textToImage` or registered-`step` body, and on the refusal `submit()` resolves for those kinds when a budget, spend cap or rate limit refuses the quoted price. **`0` means a fee was looked up and none applies** to the request.
- **Absent** when the total is not itemised: an older host; every snapshot of a submitted workflow (`submit` success, `poll`, `cancel`), whose `total` is the generation's realized cost; the registered-`step` `submit()` refusal for a missing orchestrator price quote, which refuses before any fee is looked up; and `customComfy`, pass-through `step` and `training` quotes, which price no fee. Do not read absent as `0`.
- The inbound snapshot validator accepts the field and refuses a present value that is not a finite number `>= 0`, as it does for the other optional snapshot fields.
- **Mock host (`createMockHost` / the dev harness):** new `generation.authorFee` (a number, a `(body) => number`, or `false`; URL `?authorFee=<n>` / `?authorFee=off`). The fee is added into the quote's `cost.total` on top of `costPerGen` and itemised beside it, on the estimate and on the `submitCapRefusal` reply, for `textToImage` and registered-`step` bodies. A simulated balance is debited `costPerGen + authorFee`. 🔴 **The default is `0`, so those two replies now carry `authorFee: 0`** where they carried `cost: { total }` alone; a test that deep-equals the mock's `cost` needs the extra key, or `authorFee: false` to simulate an older host.
