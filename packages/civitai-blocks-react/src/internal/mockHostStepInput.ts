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
 * MIRRORS the server's `refuseInlineMedia` superRefine and the byte-cap refine
 * after it, over the same fields (the step `input`; or each workflow step
 * `input` and then `arguments`, which a step can `$ref`):
 *  - one value budget SHARED by every field of the body; a spent budget refuses
 *    the whole body with the arm's own message;
 *  - the inline-media issue path is the field prefix plus the offending path,
 *    and the message names the same path WITHOUT the procedure's `body` segment;
 *  - the search counts the JSON length of the strings it passes, and once that
 *    is over the byte cap it reads no further string — so a photo AFTER a string
 *    that already crossed the cap gets the BYTE-CAP refusal, while the string
 *    that crosses it is still searched (an oversized photo gets the media one);
 *  - an inline-media or budget issue is added with `continue: false`, so the
 *    byte cap never also reports — the error is always ONE issue.
 * The issue shape (`code`, `path`, `message`, in that order, `continue`
 * stripped) and the byte-cap message were measured against zod 4 with the
 * server's schema shape.
 */

import { isWellFormedWorkflowShape } from './mockWorkflowGraph.js';
import {
  INLINE_MEDIA_MAX_VISITS,
  INLINE_MEDIA_OVER_BYTE_LIMIT,
  INLINE_MEDIA_TOO_MANY_VALUES,
  type InlineMediaPath,
  PASS_THROUGH_INPUT_BYTES_MAX,
  findInlineMediaPath,
  inlineMediaMessage,
} from './stepInputLimits.js';

/** The server's byte-cap message for a pass-through step `input` (issue path `input`). */
export const MOCK_STEP_INPUT_BYTES_ERROR = `step input exceeds the ${PASS_THROUGH_INPUT_BYTES_MAX}-byte limit`;

/** The server's summed byte-cap message for a `kind: 'workflow'` body (issue path `steps`). */
export const MOCK_WORKFLOW_INPUT_BYTES_ERROR = `workflow step inputs and arguments exceed the ${PASS_THROUGH_INPUT_BYTES_MAX}-byte limit`;

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
type Fields = [InlineMediaPath, unknown][];

/** The server's `refuseInlineMedia`: the first hit across `fields`, sharing one budget. */
function inlineMediaIssue(fields: Fields, overflow: Issue): Issue | null {
  const budget = { visits: 0 };
  for (const [prefix, value] of fields) {
    const hit = findInlineMediaPath(value, budget, PASS_THROUGH_INPUT_BYTES_MAX);
    if (!hit || hit === INLINE_MEDIA_OVER_BYTE_LIMIT) continue;
    if (hit === INLINE_MEDIA_TOO_MANY_VALUES) return overflow;
    const path = [...prefix, ...hit];
    return { path, message: inlineMediaMessage(path) };
  }
  return null;
}

/**
 * The summed `JSON.stringify(value).length` of `fields` (a value it writes
 * nothing for, like an absent `arguments`, counts 0) — the verdict the server's
 * `jsonLengthWithin` gives. `null` when JSON cannot serialize one (a `BigInt`,
 * a cycle): a structured-clone payload can carry either, and such an input is
 * left to the checks that already model it, not reported as a size.
 */
function serializedLength(fields: Fields): number | null {
  try {
    return fields.reduce((sum, [, value]) => sum + (JSON.stringify(value)?.length ?? 0), 0);
  } catch {
    return null;
  }
}

/** Inline media / value budget first; the byte cap only when that found nothing. */
function fieldsIssue(fields: Fields, overflow: Issue, overCap: Issue): Issue | null {
  const media = inlineMediaIssue(fields, overflow);
  if (media !== null) return media;
  const size = serializedLength(fields);
  return size !== null && size > PASS_THROUGH_INPUT_BYTES_MAX ? overCap : null;
}

/**
 * The refusal text for `body`'s step input(s), or `null` to proceed.
 * `issuePathPrefix` is `['body']` for an estimate or submit (the field of the
 * procedure input) and `[]` for a batch cell (parsed on its own).
 *
 *  - A pass-through `kind: 'step'` body (no `step` id): its `input`.
 *  - A `kind: 'workflow'` body: each step's `input`, then `arguments`; its byte
 *    cap is their SUM.
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
    issue = fieldsIssue(
      [[['input'], body.input]],
      { path: ['input'], message: MOCK_STEP_INPUT_TOO_MANY_VALUES_ERROR },
      { path: ['input'], message: MOCK_STEP_INPUT_BYTES_ERROR },
    );
  } else if (body.kind === 'workflow' && isWellFormedWorkflowShape(body)) {
    issue = fieldsIssue(
      [
        ...body.steps.map((step, i): [InlineMediaPath, unknown] => [['steps', i, 'input'], step.input]),
        [['arguments'], body.arguments],
      ],
      { path: ['steps'], message: MOCK_WORKFLOW_INPUT_TOO_MANY_VALUES_ERROR },
      { path: ['steps'], message: MOCK_WORKFLOW_INPUT_BYTES_ERROR },
    );
  }
  return issue === null ? null : zodIssueMessage([...issuePathPrefix, ...issue.path], issue.message);
}
