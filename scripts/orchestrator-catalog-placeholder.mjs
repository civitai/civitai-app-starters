/**
 * The single source of the placeholder sentinel shared by the orchestrator
 * catalog WRITE twin (`sync-orchestrator-catalogs.mjs`) and the READ guard
 * (`check-orchestrator-catalogs.mjs`).
 *
 * WHY IT IS ITS OWN FILE. The writer emits this string; the checker fails on
 * it. Two copies of a sentinel drift silently and the failure mode is the worst
 * one available here — the checker stops recognising the writer's placeholder,
 * so an uncurated description ships and every signal reads green. Neither
 * script can import the other (both run `main()` at module top level), and both
 * must run with no `pnpm install`, so a dependency-free module they both import
 * is the only single-source option.
 *
 * 🔴 THE STRING IS SHIPPED TO DEVELOPERS. `WORKFLOW_STEP_TYPES` is a
 * `Record<stepType, one-line description>` that developers browse to pick a
 * step, so whatever the writer puts here is read by a human as the catalog's
 * answer for that step. It therefore says plainly that there IS no description
 * yet, rather than guessing one: a wrong description is worse than an absent
 * one, and the orchestrator spec frequently gives nothing to derive from (see
 * `deriveDescription` in the writer).
 */

/**
 * Substring the checker greps for. A description CONTAINING this is uncurated.
 * Kept short and stable so an editor can extend the sentence around it without
 * defeating the check — the check is a `includes()`, not an equality test.
 */
export const PLACEHOLDER_SENTINEL = 'TODO(catalog): no description yet';

/** The full line the writer emits as a catalog value. */
export const PLACEHOLDER_DESCRIPTION =
  `${PLACEHOLDER_SENTINEL} — auto-added from the orchestrator spec; ` +
  `a maintainer must replace this line before merging`;
