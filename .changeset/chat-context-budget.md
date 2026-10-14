---
'@civitai/components-chat': minor
---

A long chat no longer forgets what it is for. When the conversation is over its budget, the oldest turns' long tool results give way first (the call stays, its result becomes a note; a generation's, post's, panel's or choice's result is kept), and only then whole turns, with one "(N earlier turns omitted)" note in their place. The chat's first message and every answer to a set of options are kept even then, within a quarter of the budget. The budget is configurable: `configureChat({ contextBudgetTokens })` (default 24,000), and the model picker's context-window filter uses the same value.
