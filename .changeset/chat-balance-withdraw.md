---
'@civitai/components-chat': minor
---

The chat balance has **Withdraw**, which pays what is left back to the viewer, and a balance left unused for 7 days is now paid back rather than lost. Needs the orchestrator release that refunds a single depositor's fund (`POST /v2/consumer/funds/{id}/refund`, and on expiry). Balances opened before it keep the old rule.
