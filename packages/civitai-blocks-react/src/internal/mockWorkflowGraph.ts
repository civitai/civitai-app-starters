/**
 * The mock host's checks on a multi-step `kind: 'workflow'` body: its shape,
 * its step cap, its step names and reference graph, and the step-type denylist.
 *
 * A MIRROR of the host's rules, kept in its own pure module so the estimate, the
 * batch estimate and the submit all refuse the same bodies, in the same order,
 * with the same `errorCode`.
 *
 * 🔴 AN APPROXIMATION, NOT THE HOST. It checks WHERE a reference points, never
 * whether its `path` exists, and it prices nothing. A body this accepts can
 * still be refused by the real host or by the orchestrator.
 */

import { PASS_THROUGH_INPUT_BYTES_MAX } from './stepInputLimits.js';

/**
 * The bounds the mock enforces. `maxSteps` is a COPY of
 * `@civitai/app-sdk/blocks`'s `BLOCK_WORKFLOW_MAX_STEPS`, deliberately not
 * value-imported: a value import of a symbol the newest PUBLISHED app-sdk lacks
 * raises this package's peer floor
 * (`tests/guards/blocks-react-peer-floor.test.mjs`). It is held to the SDK's
 * value by `test/mockHostWorkflowKind.test.tsx`, which imports both.
 */
export const MOCK_WORKFLOW_BOUNDS = {
  /** Steps in one body. */
  maxSteps: 8,
  /** Reference objects across every step input of one body. */
  maxRefs: 64,
  /** Nesting depth of one step `input`. */
  maxInputDepth: 32,
  /** How deep a `repeat` template may nest another `repeat`. */
  maxRepeatNesting: 4,
  /**
   * Serialized bytes of every step `input` plus `arguments`, summed. The host's
   * `WORKFLOW_INPUT_BYTES_MAX`, which is its pass-through cap by definition.
   */
  maxInputBytes: PASS_THROUGH_INPUT_BYTES_MAX,
  /** Characters of a step `$type`, and of a step `name` on the wire. */
  maxTypeChars: 64,
  /**
   * Iterations of one top-level `repeat` step, nested repeats MULTIPLIED. A
   * COPY of `@civitai/app-sdk/blocks`'s `BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS`,
   * held to it by the same test as `maxSteps`.
   */
  maxRepeatIterations: 16,
} as const;

/**
 * Orchestrator `$type`s a `kind: 'workflow'` step may not name: the host's
 * platform-internal list (scanners, moderation classifiers, hashing and model
 * ingestion, the catalog's platform internals, web scrape/search and the
 * retired `textToImage` step type) plus `promptModeration`. Matched
 * case-insensitively, as the host matches. Anything else is accepted,
 * including a `$type` this list has never heard of.
 */
export const MOCK_WORKFLOW_DENIED_STEP_TYPES: readonly string[] = Object.freeze([
  'modelPickleScan',
  'modelClamScan',
  'imageScanning',
  'xGuardModeration',
  'shieldstralModeration',
  'promptModeration',
  'mediaHash',
  'modelHash',
  'modelParseMetadata',
  'comfyNodepackSnapshot',
  'qwenImageBench',
  'webScrape',
  'webSearch',
  'textToImage',
]);
const DENIED_LOOKUP = new Set(MOCK_WORKFLOW_DENIED_STEP_TYPES.map((t) => t.toLowerCase()));

/** A refused body: the reply's `error` and, where one is defined, its `errorCode`. */
export interface MockWorkflowRefusal {
  error: string;
  errorCode?:
    | 'workflow_step_denied'
    | 'workflow_ref_invalid'
    | 'workflow_too_many_steps'
    | 'workflow_repeat_unbounded'
    | `training-quote-${MockWorkflowQuoteFailure}`
    | `workflow_quote_${MockWorkflowQuoteFailure}`;
}

/**
 * Why the host has no price quote for a workflow (its `PassThroughQuoteFailure`
 * kinds): `'rejected'` — the orchestrator refused the body, so the same body
 * will fail again; `'unavailable'` — no usable answer, the one cause a retry of
 * the same body can clear; `'unpriced'` — an answer without a price.
 */
export type MockWorkflowQuoteFailure = 'rejected' | 'unavailable' | 'unpriced';

const ARGUMENTS_REF = '$arguments';
/** The name the single-step kinds give their one step; a workflow step may not take it. */
const RESERVED_STEP_NAME = 'block-step';
const STEP_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
/** The only keys a reference object may carry. */
const REF_KEYS: ReadonlySet<string> = new Set(['$ref', 'path', 'default', 'format']);
const BODY_KEYS: ReadonlySet<string> = new Set(['kind', 'steps', 'arguments']);
const STEP_KEYS: ReadonlySet<string> = new Set(['name', '$type', 'input', 'suppressOutput']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isRepeat = (stepType: unknown): boolean =>
  typeof stepType === 'string' && stepType.toLowerCase() === 'repeat';

/** What a step is called in a reference and on the snapshot: its `name`, or `'$<index>'`. */
export const mockWorkflowStepName = (step: { name?: unknown }, index: number): string =>
  typeof step.name === 'string' ? step.name : `$${index}`;

const isMerge = (stepType: unknown): boolean =>
  typeof stepType === 'string' && stepType.toLowerCase() === 'merge';

const hasOnlyKeys = (object: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(object).every((key) => allowed.includes(key));

type RepeatInput = {
  forClause: { $ref: string; path: string; as: string };
  template: { $type: string; name?: string; input?: unknown };
};

/**
 * A `repeat` step's input, or `null` unless it is EXACTLY
 * `{ for: { $ref, path, as }, template: { $type, name?, input? } }` with string
 * `$ref` / `path` / `as` / `$type` (and `name`, when present). Fail-closed on
 * shape, every key spelled exactly, as the host reads it.
 */
function readRepeatInput(input: unknown): RepeatInput | null {
  if (!isPlainObject(input) || !hasOnlyKeys(input, ['for', 'template'])) return null;
  const { for: forClause, template } = input;
  if (!isPlainObject(forClause) || !hasOnlyKeys(forClause, ['$ref', 'path', 'as'])) return null;
  if (
    typeof forClause.$ref !== 'string' ||
    typeof forClause.path !== 'string' ||
    typeof forClause.as !== 'string'
  ) {
    return null;
  }
  if (!isPlainObject(template) || !hasOnlyKeys(template, ['$type', 'name', 'input'])) return null;
  if (typeof template.$type !== 'string') return null;
  if (template.name !== undefined && typeof template.name !== 'string') return null;
  return { forClause: forClause as RepeatInput['forClause'], template: template as RepeatInput['template'] };
}

/** The refusal for a `repeat` whose shape or nesting the mock cannot follow. */
export const MOCK_REPEAT_SHAPE_ERROR =
  'a repeat step needs exactly { for: { $ref, path, as }, template: { $type, name?, input? } }, ' +
  `nested at most ${MOCK_WORKFLOW_BOUNDS.maxRepeatNesting} deep`;

/** The refusal for a `merge` whose sources the mock cannot read. */
export const MOCK_MERGE_SHAPE_ERROR =
  'a merge step needs a "fields" object whose entries each carry a string "$ref" and a "reduce"';

/** The array a `for` path names in `arguments`, by exact own keys, or `null`. */
function readArgumentsArray(args: unknown, path: string): unknown[] | null {
  let current: unknown = args;
  for (const part of path.split('.')) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return Array.isArray(current) ? current : null;
}

/**
 * THE REPEAT BOUND. A refusal message, or `null` when the step is not a
 * `repeat` or its loop is bounded: it iterates an array in the body's own
 * `arguments` (so its length is fixed in the submitted body), and the count,
 * nested repeats multiplied, is at most `maxRepeatIterations`.
 */
function repeatUnboundedProblem(
  stepType: unknown,
  input: unknown,
  args: unknown,
  outerIterations = 1,
): string | null {
  if (!isRepeat(stepType)) return null;
  const repeat = readRepeatInput(input);
  if (!repeat) return MOCK_REPEAT_SHAPE_ERROR;
  const { forClause, template } = repeat;
  if (forClause.$ref !== ARGUMENTS_REF) {
    return (
      `a repeat may only iterate over the workflow's own arguments ("$ref": "${ARGUMENTS_REF}"), ` +
      `not ${JSON.stringify(forClause.$ref)} — pass the list in "arguments" instead`
    );
  }
  const items = readArgumentsArray(args, forClause.path);
  if (!items) return `repeat "for" path ${JSON.stringify(forClause.path)} does not name an array in "arguments"`;
  const iterations = outerIterations * items.length;
  if (iterations > MOCK_WORKFLOW_BOUNDS.maxRepeatIterations) {
    return (
      `a repeat may run at most ${MOCK_WORKFLOW_BOUNDS.maxRepeatIterations} iterations, nested repeats ` +
      `multiplied (got ${iterations})`
    );
  }
  return repeatUnboundedProblem(template.$type, template.input, args, iterations);
}

/**
 * How many generations a step runs: 1, or a `repeat`'s iteration count with
 * nested repeats multiplied (never less than 1). Only meaningful for a body
 * {@link mockWorkflowBodyRefusal} accepted.
 */
export function mockWorkflowStepGenerations(stepType: string, input: unknown, args: unknown): number {
  if (!isRepeat(stepType)) return 1;
  const repeat = readRepeatInput(input);
  const items = repeat ? readArgumentsArray(args, repeat.forClause.path) : null;
  if (!repeat || !items) return 1;
  return Math.max(1, items.length * mockWorkflowStepGenerations(repeat.template.$type, repeat.template.input, args));
}

/** The source each `merge` field reads, or `null` when that cannot be read for certain. */
function readMergeSources(input: unknown): string[] | null {
  if (!isPlainObject(input)) return null;
  if (Object.keys(input).some((key) => key !== 'fields' && key.toLowerCase() === 'fields')) return null;
  const { fields } = input;
  if (!isPlainObject(fields)) return null;
  const sources: string[] = [];
  for (const field of Object.values(fields)) {
    if (!isPlainObject(field)) return null;
    if (Object.keys(field).some((key) => key !== '$ref' && key.toLowerCase() === '$ref')) return null;
    // Without `reduce` the entry is a plain reference, which the orchestrator
    // replaces with what it points at before the merge reads it.
    if (typeof field.$ref !== 'string' || !('reduce' in field)) return null;
    sources.push(field.$ref);
  }
  return sources;
}

/**
 * Every `$type` a step can run: its own and, for a `repeat`, its template's.
 * `null` for a `repeat` whose shape it cannot follow, or nested past the bound.
 */
function collectStepTypes(stepType: string, input: unknown): string[] | null {
  const types: string[] = [];
  let currentType = stepType;
  let currentInput = input;
  for (let depth = 0; depth <= MOCK_WORKFLOW_BOUNDS.maxRepeatNesting; depth += 1) {
    types.push(currentType);
    if (!isRepeat(currentType)) return types;
    const repeat = readRepeatInput(currentInput);
    if (!repeat) return null;
    currentType = repeat.template.$type;
    currentInput = repeat.template.input;
  }
  return null;
}

/**
 * A reference is an object with BOTH `$ref` and `path` and no key other than
 * `default` / `format`. Anything else — including an object that has `$ref` but
 * no `path` — is ordinary input and is walked, not judged.
 */
function isRefObject(value: Record<string, unknown>): boolean {
  if (!('$ref' in value) || !('path' in value)) return false;
  return Object.keys(value).every((key) => REF_KEYS.has(key));
}

type WalkState = { refs: number; loopVars: Set<string> };

function checkSource(source: string, sources: ReadonlySet<string>, state: WalkState): string | null {
  state.refs += 1;
  if (state.refs > MOCK_WORKFLOW_BOUNDS.maxRefs) {
    return `a workflow may hold at most ${MOCK_WORKFLOW_BOUNDS.maxRefs} references`;
  }
  // THE BACKWARDS-ONLY RULE: `sources` holds `$arguments` and the names of the
  // steps BEFORE this one, so the step itself, a later step and a name that
  // does not exist all miss it the same way.
  if (!sources.has(source)) {
    return `"$ref": ${JSON.stringify(source)} does not name "${ARGUMENTS_REF}" or an earlier step`;
  }
  return null;
}

/** A refusal message, or `null` when `value` is fine. */
function checkValue(
  value: unknown,
  depth: number,
  sources: ReadonlySet<string>,
  state: WalkState,
): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (depth > MOCK_WORKFLOW_BOUNDS.maxInputDepth) {
    return `input is nested deeper than ${MOCK_WORKFLOW_BOUNDS.maxInputDepth} levels`;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const problem = checkValue(entry, depth + 1, sources, state);
      if (problem) return problem;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  if (isRefObject(object)) {
    if (typeof object.$ref !== 'string' || typeof object.path !== 'string') {
      return 'a reference needs a string "$ref" and a string "path"';
    }
    if (object.format !== undefined && object.format !== null && typeof object.format !== 'string') {
      return 'a reference "format" must be a string';
    }
    return checkSource(object.$ref, sources, state);
  }
  for (const entry of Object.values(object)) {
    const problem = checkValue(entry, depth + 1, sources, state);
    if (problem) return problem;
  }
  return null;
}

/**
 * Check one step's input. Two step types name their sources outside a reference
 * object and are read by shape: `repeat` (its `for` clause, with the `as` name a
 * legal source inside its template) and `merge` (its fields).
 */
function checkStepInput(
  stepType: unknown,
  input: unknown,
  depth: number,
  sources: ReadonlySet<string>,
  state: WalkState,
): string | null {
  if (isMerge(stepType)) {
    const mergeSources = readMergeSources(input);
    if (!mergeSources) return MOCK_MERGE_SHAPE_ERROR;
    for (const source of mergeSources) {
      // A merge waits on its sources as STEPS, so a loop variable is not one.
      if (state.loopVars.has(source)) {
        return `a merge field cannot read the repeat variable ${JSON.stringify(source)}`;
      }
      const problem = checkSource(source, sources, state);
      if (problem) return problem;
    }
    return checkValue(input, depth, sources, state);
  }
  if (!isRepeat(stepType)) return checkValue(input, depth, sources, state);
  const repeat = readRepeatInput(input);
  if (!repeat) return MOCK_REPEAT_SHAPE_ERROR;
  const { forClause, template } = repeat;
  const sourceProblem = checkSource(forClause.$ref, sources, state);
  if (sourceProblem) return sourceProblem;
  state.loopVars.add(forClause.as);
  return checkStepInput(template.$type, template.input, depth + 2, new Set([...sources, forClause.as]), state);
}

/**
 * The host's `quoteFailureCause`: why there is no quote, as the clause that
 * completes "…needs a price quote and ". Only `'unavailable'` says "try again".
 * The mock has no orchestrator message to pass on, so `'rejected'` is the host's
 * wording for a rejection with no reason safe to show.
 */
const MOCK_QUOTE_FAILURE_CAUSE: Record<MockWorkflowQuoteFailure, string> = {
  rejected:
    'the orchestrator rejected the request; check the step inputs and references ' +
    '(retrying the same body will not help)',
  unavailable: 'none could be obtained; try again',
  unpriced: 'the orchestrator answered without one',
};

/** The host's refusal text for an unquoted training step (`unquotedTrainingRefusal`). */
export const mockUnquotedTrainingError = (failure: MockWorkflowQuoteFailure): string =>
  `Training needs a price quote and ${MOCK_QUOTE_FAILURE_CAUSE[failure]}.`;

/**
 * The refusal, on BOTH the estimate and the submit, for a body
 * {@link mockWorkflowBodyRefusal} ACCEPTED when the host has no price quote for
 * it, or `null` when the submit would proceed (reserved at the ceiling). In the
 * host's order: a training step anywhere (`training-quote-<failure>`), then a
 * `repeat` anywhere (`workflow_repeat_unbounded`, naming the first such step).
 * The message states the cause.
 */
export function mockUnpricedWorkflowRefusal(
  body: { steps: ReadonlyArray<{ $type: string; input: unknown }> },
  failure: MockWorkflowQuoteFailure,
): MockWorkflowRefusal | null {
  const types = body.steps.map((step) => collectStepTypes(step.$type, step.input) ?? [step.$type]);
  if (types.some((ts) => ts.some((t) => t === 'training' || t === 'imageResourceTraining'))) {
    return { error: mockUnquotedTrainingError(failure), errorCode: `training-quote-${failure}` };
  }
  const index = types.findIndex((ts) => ts.some(isRepeat));
  if (index === -1) return null;
  return {
    error: `workflow step ${index}: a workflow with a repeat needs a price quote and ${MOCK_QUOTE_FAILURE_CAUSE[failure]}`,
    errorCode: 'workflow_repeat_unbounded',
  };
}

/**
 * The host's `unquotedWorkflowEstimateRefusal`: what an ESTIMATE of a workflow
 * with no price quote fails with when {@link mockUnpricedWorkflowRefusal} did
 * not already refuse it. Estimate only — the submit of the same body proceeds.
 */
export function mockUnquotedWorkflowEstimateRefusal(failure: MockWorkflowQuoteFailure): MockWorkflowRefusal {
  return {
    error: `No price quote for this workflow: ${MOCK_QUOTE_FAILURE_CAUSE[failure]}`,
    errorCode: `workflow_quote_${failure}`,
  };
}

type WellFormedWorkflowBody = {
  steps: Array<{ name?: string; $type: string; input: Record<string, unknown>; suppressOutput?: boolean }>;
  arguments?: Record<string, unknown>;
};

/**
 * The host's wire schema, mirrored: exact keys, types and sizes — everything
 * but the summed byte cap. Exported so the step-input gate
 * (`mockHostStepInput.ts`) runs its rules only on a body the schema's shape
 * accepts, as zod runs a refinement only after the shape parses.
 */
export function isWellFormedWorkflowShape(body: unknown): body is WellFormedWorkflowBody {
  if (!isPlainObject(body) || !Object.keys(body).every((key) => BODY_KEYS.has(key))) return false;
  if (!Array.isArray(body.steps) || body.steps.length === 0) return false;
  if (body.arguments !== undefined && !isPlainObject(body.arguments)) return false;
  for (const step of body.steps) {
    if (!isPlainObject(step) || !Object.keys(step).every((key) => STEP_KEYS.has(key))) return false;
    const { name, $type, input, suppressOutput } = step;
    if (typeof $type !== 'string' || $type.length < 1 || $type.length > MOCK_WORKFLOW_BOUNDS.maxTypeChars) {
      return false;
    }
    if (
      name !== undefined &&
      (typeof name !== 'string' || name.length < 1 || name.length > MOCK_WORKFLOW_BOUNDS.maxTypeChars)
    ) {
      return false;
    }
    if (!isPlainObject(input)) return false;
    if (suppressOutput !== undefined && typeof suppressOutput !== 'boolean') return false;
  }
  return true;
}

/** The host's wire schema, mirrored in full: the shape, then the summed byte cap. No `errorCode`. */
function isWellFormedBody(body: unknown): body is WellFormedWorkflowBody {
  if (!isWellFormedWorkflowShape(body)) return false;
  let bytes = body.arguments ? JSON.stringify(body.arguments).length : 0;
  for (const step of body.steps) bytes += JSON.stringify(step.input).length;
  return bytes <= MOCK_WORKFLOW_BOUNDS.maxInputBytes;
}

/**
 * The refusal for a `kind: 'workflow'` body, or `null` for one the mock will
 * price and run. In the host's order:
 *
 *  1. the wire shape — no `errorCode`, the host's schema rejection;
 *  2. the step cap — `workflow_too_many_steps`;
 *  3. step by step: the name rules and a `repeat`'s exact shape and nesting
 *     (`workflow_ref_invalid`); the repeat bound — only over an array in
 *     `arguments`, at most 16 iterations with nested repeats multiplied
 *     (`workflow_repeat_unbounded`); then the reference graph
 *     (`workflow_ref_invalid`). A name is `[a-z][a-z0-9_-]{0,31}` (or the
 *     step's own `$<index>`), unique, and not `block-step`; every source — a
 *     reference, a `repeat`'s `for`, a `merge` field — names `$arguments` or an
 *     EARLIER step, and a `merge` field never names a repeat variable;
 *  4. a repeat `as` name that is also a step name — `workflow_ref_invalid`;
 *  5. the step-type denylist on every step and on the step a `repeat` runs —
 *     `workflow_step_denied`.
 */
export function mockWorkflowBodyRefusal(body: unknown): MockWorkflowRefusal | null {
  if (!isWellFormedBody(body)) return { error: 'invalid workflow body' };
  const { steps } = body;
  if (steps.length > MOCK_WORKFLOW_BOUNDS.maxSteps) {
    return {
      error: `a workflow may have at most ${MOCK_WORKFLOW_BOUNDS.maxSteps} steps (got ${steps.length})`,
      errorCode: 'workflow_too_many_steps',
    };
  }
  const invalid = (index: number, problem: string): MockWorkflowRefusal => ({
    error: `workflow step ${index}: ${problem}`,
    errorCode: 'workflow_ref_invalid',
  });

  const earlier = new Set<string>([ARGUMENTS_REF]);
  const taken = new Set<string>();
  const state: WalkState = { refs: 0, loopVars: new Set() };
  const stepTypes: string[][] = [];
  for (const [index, step] of steps.entries()) {
    const positional = `$${index}`;
    const name = mockWorkflowStepName(step, index);
    if (name !== positional && !STEP_NAME_PATTERN.test(name)) {
      return invalid(
        index,
        `name ${JSON.stringify(name)} must match ${STEP_NAME_PATTERN.source} or be "${positional}"`,
      );
    }
    if (name === RESERVED_STEP_NAME) return invalid(index, `name "${RESERVED_STEP_NAME}" is reserved`);
    if (taken.has(name)) return invalid(index, `name ${JSON.stringify(name)} is used twice`);

    const types = collectStepTypes(step.$type, step.input);
    if (types === null) return invalid(index, MOCK_REPEAT_SHAPE_ERROR);
    const unbounded = repeatUnboundedProblem(step.$type, step.input, body.arguments);
    if (unbounded !== null) {
      return { error: `workflow step ${index}: ${unbounded}`, errorCode: 'workflow_repeat_unbounded' };
    }
    const problem = checkStepInput(step.$type, step.input, 0, earlier, state);
    if (problem) return invalid(index, problem);

    taken.add(name);
    earlier.add(name);
    stepTypes.push(types);
  }
  // A repeat variable that is also a step name (or `$arguments`) would make a
  // template reference ambiguous between the two.
  for (const loopVar of state.loopVars) {
    if (earlier.has(loopVar)) {
      return {
        error: `a repeat "as" name ${JSON.stringify(loopVar)} is also a step name or "${ARGUMENTS_REF}"`,
        errorCode: 'workflow_ref_invalid',
      };
    }
  }

  for (const [index, types] of stepTypes.entries()) {
    const denied = types.find((t) => DENIED_LOOKUP.has(t.toLowerCase()));
    if (denied !== undefined) {
      return {
        error: `workflow step ${index}: orchestrator step type '${denied}' is platform-internal and cannot be submitted by an app block`,
        errorCode: 'workflow_step_denied',
      };
    }
  }
  return null;
}
