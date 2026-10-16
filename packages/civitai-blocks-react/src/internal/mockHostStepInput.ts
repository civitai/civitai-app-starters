/**
 * The mock host's STEP-INPUT GATE: the inline-media rule and the byte cap the
 * real host applies to every pass-through step `input`, on the estimate, each
 * batch-estimate cell and the submit.
 *
 * WHAT THE REAL HOST SENDS BACK. Both rules are zod refinements of the body
 * schema (civitai/civitai `src/server/schema/blocks/workflow.schema.ts`), so a
 * refusal is a tRPC `BAD_REQUEST` thrown at the procedure's `.input()` — before
 * the handler, and so before the spend-scope check, the budget and any debit.
 * tRPC uses the `ZodError`'s message as the error message, which is the issue
 * list as pretty-printed JSON, and the page host catches the rejected mutation
 * into `failureSnapshot(err)` (`src/components/AppBlocks/failureSnapshot.ts`):
 *
 *     { workflowId: 'failed', status: 'failed', error: '[\n  {\n    "code": "custom", … }\n]' }
 *
 * with NO `cost`, so `estimate()` rejects with `WorkflowEstimateError` code
 * `'failed'` and `submit()` with `WorkflowSubmitError` code `'exception'`. A
 * batch cell is parsed against the same schema inside the procedure and gets
 * the same snapshot, its issue path relative to the cell rather than `body`.
 *
 * The byte-cap message was measured against zod 4 with the server's schema
 * shape. The inline-media message is the one the server change this mirrors
 * specifies; match on its words, not on the JSON around them.
 *
 * The inline-media rule is checked FIRST, so an oversized photo gets the
 * message that says what to do instead.
 */

import { isWellFormedWorkflowShape } from './mockWorkflowGraph.js';
import { PASS_THROUGH_INPUT_BYTES_MAX, findInlineMedia } from './stepInputLimits.js';

/** The server's byte-cap message for a pass-through step `input`. */
export const MOCK_STEP_INPUT_BYTES_ERROR = `step input exceeds the ${PASS_THROUGH_INPUT_BYTES_MAX}-byte limit`;

/** The server's inline-media message, for the offending path within the step `input`. */
export const mockStepInputInlineMediaError = (path: string): string =>
  `step input ${path} carries inline media (data URI/base64); upload it with ` +
  `useImageUpload({ purpose: 'generationSource' }) or pick it with useImagePicker and pass the returned url`;

/** `ZodError.message` for a single custom issue — what tRPC hands the host as `err.message`. */
export function zodIssueMessage(path: ReadonlyArray<string | number>, message: string): string {
  return JSON.stringify([{ code: 'custom', path, message }], null, 2);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** One step `input`: the inline-media rule, then the byte cap. */
function inputRefusal(
  input: Record<string, unknown>,
  at: ReadonlyArray<string | number>,
  checkBytes: boolean,
): string | null {
  const media = findInlineMedia(input);
  if (media !== null) return zodIssueMessage(at, mockStepInputInlineMediaError(media));
  if (checkBytes) {
    const size = serializedLength(input);
    if (size !== null && size > PASS_THROUGH_INPUT_BYTES_MAX) {
      return zodIssueMessage(at, MOCK_STEP_INPUT_BYTES_ERROR);
    }
  }
  return null;
}

/**
 * `JSON.stringify(input).length`, or `null` when JSON cannot serialize it (a
 * `BigInt`, a cycle). A structured-clone payload can carry either; such an
 * input is left to the checks that already model it (the confirmed-step
 * non-JSON refusal), not reported as a size.
 */
function serializedLength(input: Record<string, unknown>): number | null {
  try {
    return JSON.stringify(input).length;
  } catch {
    return null;
  }
}

/**
 * The refusal text for `body`'s step input(s), or `null` to proceed.
 * `issuePathPrefix` is `['body']` for an estimate or submit (the field of the
 * procedure input) and `[]` for a batch cell (parsed on its own).
 *
 *  - A pass-through `kind: 'step'` body (no `step` id): its `input`, both rules.
 *  - A `kind: 'workflow'` body: each step's `input`, inline media only. Its byte
 *    cap is a SUM over every step and `arguments`, enforced with the rest of the
 *    workflow wire shape in `mockWorkflowGraph.ts`.
 *
 * Any other body, a step whose `input` is not an object, or a workflow whose
 * wire shape is wrong, is left to the checks that already handle it — zod
 * refuses the shape before these refinements run.
 */
export function stepInputRefusal(
  body: unknown,
  issuePathPrefix: ReadonlyArray<string | number>,
): string | null {
  if (!isPlainObject(body)) return null;
  if (body.kind === 'step' && body.step === undefined) {
    if (!isPlainObject(body.input)) return null;
    return inputRefusal(body.input, [...issuePathPrefix, 'input'], true);
  }
  if (body.kind === 'workflow' && isWellFormedWorkflowShape(body)) {
    for (const [index, step] of body.steps.entries()) {
      const refusal = inputRefusal(step.input, [...issuePathPrefix, 'steps', index, 'input'], false);
      if (refusal !== null) return refusal;
    }
  }
  return null;
}
