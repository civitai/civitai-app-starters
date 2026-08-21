---
'@civitai/blocks-react': patch
---

Document `WorkflowEstimateError.message` as DEVELOPER-facing, so a migrating app
stops piping it into rendered UI.

`0.43.0` moved the server's raw text off `message` and onto `.snapshot.error`,
leaving `message` a generic constant
(`estimate did not return a usable price (failed) — reason on .snapshot.error`).
That was deliberate — `message` is what an uncaught rejection prints and what a
third-party error reporter ships upstream, so raw upstream text (Prisma/`pg`
constraint names among it) must not live there.

But the guidance said **"print `err.message`"**, which reads as viewer-facing.
Two apps migrated to `0.43.0` on the same day and **both** had a `try/catch`
piping `err.message` straight into rendered UI; both would have shipped that
sentence to end users, and each was caught only by a test asserting the exact
string. Nothing in the docs told them not to.

No behaviour change — this is documentation only, but the class JSDoc ships in
`dist/hooks/useBuzzWorkflow.d.ts` and is the IDE hover text every block author
reads, so it is a change to the published contract surface.

The three fields are now documented by AUDIENCE, and the point that none of them
is viewer-facing copy is stated explicitly:

- **`code`** (`'failed' | 'no-cost'`) — the **branch target**, and the only
  stable one. Switch on it to pick a viewer-facing string the APP owns.
- **`snapshot.error`** — the **diagnostic** read. Server-authored and
  unsanitised; log it or show it in a developer-facing surface, never render it
  verbatim into markup.
- **`message`** — **developer-facing**. Safe to log and to let a stack trace
  print; not intended for display to viewers (it names an internal field path
  and is not localised), and **its exact wording is not a contract**, so a UI
  built on it silently rots.

The `@example` on `useBuzzWorkflow` and the README snippet now show the shape the
two migrating apps both converged on independently — catch, branch on `code`,
render an app-owned constant, log `message` + `snapshot.error`:

```ts
const estimateFailureMessage = (err: WorkflowEstimateError) =>
  err.code === 'no-cost'
    ? 'We could not get a price for this configuration. Try adjusting it.'
    : 'Pricing is unavailable right now. Please try again shortly.';

try {
  await estimate(body);
} catch (err) {
  if (!(err instanceof WorkflowEstimateError)) throw err;
  logForDebugging(err.message, err.snapshot.error); // developer-facing: LOG only
  showError(estimateFailureMessage(err)); // viewer-facing: app-owned
}
```

The `0.43.0` CHANGELOG entry's "print `err.message`" bullet was amended in place
rather than only corrected here, because that entry is what a consumer migrating
to `0.43.0` opens — a correction filed one version later would never be read by
the people the defect targets. The amendment is marked as a post-publish
correction and changes wording only.
