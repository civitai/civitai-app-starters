---
'@civitai/components-chat': minor
---

The chat now asks before every generation by default: `configureChat({ autoRunLimit })` defaults to 0 (was 100). A viewer who saved a limit keeps it. The confirmation offers **Yes, don't ask up to X Buzz** beside **Go ahead**, where X is the smallest Settings choice (25, 50, 100 or 250) that covers a fixed price: it runs the job and sets the viewer's limit to X. A variable price, or one above 250, still only offers Go ahead. `<civitai-chat-generation-card>` gains `raiseSteps` and the `job-raise-limit` event (`{ limit }`); the steps are exported as `AUTO_RUN_STEPS`.

The confirmation now says what it would make: the request in its own words (a prompt, a song description, a script) under the title, up to three lines, so "Make it?" and **Adjust** refer to something on screen. `GenerationJob.request` and the card's optional `CardJob.request` carry it.
