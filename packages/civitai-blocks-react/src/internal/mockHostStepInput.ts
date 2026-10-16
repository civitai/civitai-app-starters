/**
 * The mock host's STEP-INPUT GATE: the inline-media rule and the byte cap the
 * real host applies to a pass-through step body, on the estimate, each
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
 * MIRRORS the server's `refuseInlineMedia` superRefine:
 *  - one value budget SHARED by every field of the body (the step `input`; or
 *    each workflow step `input` and then `arguments`, which a step can `$ref`);
 *  - the issue path is the field prefix plus the offending path, and the
 *    message names the same path WITHOUT the procedure's `body` segment;
 *  - a spent budget refuses the whole body with the arm's own message;
 *  - the issue is added with `continue: false`, so the byte cap never also
 *    reports — the error is ONE issue, and it names the fix.
 * The issue shape (`code`, `path`, `message`, in that order, `continue`
 * stripped) and the byte-cap message were measured against zod 4 with the
 * server's schema shape.
 */

import { isWellFormedWorkflowShape } from './mockWorkflowGraph.js';
import {
  INLINE_MEDIA_MAX_VISITS,
  INLINE_MEDIA_TOO_MANY_VALUES,
  type InlineMediaPath,
  PASS_THROUGH_INPUT_BYTES_MAX,
  findInlineMediaPath,
  inlineMediaMessage,
} from './stepInputLimits.js';

/** The server's byte-cap message for a pass-through step `input`. */
export const MOCK_STEP_INPUT_BYTES_ERROR = `step input exceeds the ${PASS_THROUGH_INPUT_BYTES_MAX}-byte limit`;

/** The server's value-budget refusal on the `kind: 'step'` arm (issue path `input`). */
export const MOCK_STEP_INPUT_TOO_MANY_VALUES_ERROR = `step input holds more than ${INLINE_MEDIA_MAX_VISITS} values`;

/** The server's value-budget refusal on the `kind: 'workflow'` arm (issue path `steps`). */
export const MOCK_WORKFLOW_INPUT_TOO_MANY_VALUES_ERROR = `step inputs and arguments hold more than ${INLINE_MEDIA_MAX_VISITS} values in total`;

/** `ZodError.message` for a single custom issue — what tRPC hands the host as `err.message`. */
export function zodIssueMessage(path: ReadonlyArray<string | number>, message: string): string {
  return JSON.stringify([{ code: 'custom', path, message }], null, 2);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

type Issue = { path: InlineMediaPath; message: string };

/** The server's `refuseInlineMedia`: the first hit across `fields`, sharing one budget. */
function inlineMediaIssue(fields: [InlineMediaPath, unknown][], overflow: Issue): Issue | null {
  const budget = { visits: 0 };
  for (const [prefix, value] of fields) {
    const hit = findInlineMediaPath(value, budget);
    if (!hit) continue;
    if (hit === INLINE_MEDIA_TOO_MANY_VALUES) return overflow;
    const path = [...prefix, ...hit];
    return { path, message: inlineMediaMessage(path) };
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
 *  - A pass-through `kind: 'step'` body (no `step` id): inline media in its
 *    `input`, then its byte cap.
 *  - A `kind: 'workflow'` body: inline media in each step's `input` and then in
 *    `arguments`. Its byte cap is a SUM, enforced with the rest of the workflow
 *    wire shape in `mockWorkflowGraph.ts`, which runs after this.
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
  let issue: Issue | null = null;
  if (body.kind === 'step' && body.step === undefined) {
    if (!isPlainObject(body.input)) return null;
    issue = inlineMediaIssue([[['input'], body.input]], {
      path: ['input'],
      message: MOCK_STEP_INPUT_TOO_MANY_VALUES_ERROR,
    });
    if (issue === null) {
      const size = serializedLength(body.input);
      if (size !== null && size > PASS_THROUGH_INPUT_BYTES_MAX) {
        issue = { path: ['input'], message: MOCK_STEP_INPUT_BYTES_ERROR };
      }
    }
  } else if (body.kind === 'workflow' && isWellFormedWorkflowShape(body)) {
    issue = inlineMediaIssue(
      [
        ...body.steps.map((step, i): [InlineMediaPath, unknown] => [['steps', i, 'input'], step.input]),
        [['arguments'], body.arguments],
      ],
      { path: ['steps'], message: MOCK_WORKFLOW_INPUT_TOO_MANY_VALUES_ERROR },
    );
  }
  return issue === null ? null : zodIssueMessage([...issuePathPrefix, ...issue.path], issue.message);
}
