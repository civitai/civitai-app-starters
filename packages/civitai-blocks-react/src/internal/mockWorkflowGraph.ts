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
  /** Serialized bytes of every step `input` plus `arguments`, summed. */
  maxInputBytes: 262_144,
  /** Characters of a step `$type`, and of a step `name` on the wire. */
  maxTypeChars: 64,
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
  errorCode?: 'workflow_step_denied' | 'workflow_ref_invalid' | 'workflow_too_many_steps';
}

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

/**
 * Every `$type` a step can run: its own and, for a `repeat`, its template's.
 * `null` when `repeat` templates nest deeper than the bound.
 */
function collectStepTypes(stepType: string, input: unknown): string[] | null {
  const types: string[] = [];
  let currentType: unknown = stepType;
  let currentInput: unknown = input;
  for (let depth = 0; depth <= MOCK_WORKFLOW_BOUNDS.maxRepeatNesting; depth += 1) {
    if (typeof currentType !== 'string') return types;
    types.push(currentType);
    if (!isRepeat(currentType) || !isPlainObject(currentInput)) return types;
    const template = currentInput.template;
    if (!isPlainObject(template)) return types;
    currentType = template.$type;
    currentInput = template.input;
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

type WalkState = { refs: number };

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
 * Check one step's input. `repeat` is the one shape with structure: its `for`
 * clause names what to iterate (with an extra `as` key, so it is not a
 * reference object), and inside its `template` the `as` name is a legal source.
 */
function checkStepInput(
  stepType: unknown,
  input: unknown,
  depth: number,
  sources: ReadonlySet<string>,
  state: WalkState,
  repeatDepth: number,
): string | null {
  if (!isRepeat(stepType) || !isPlainObject(input)) return checkValue(input, depth, sources, state);
  if (repeatDepth >= MOCK_WORKFLOW_BOUNDS.maxRepeatNesting) {
    return `repeat steps may nest at most ${MOCK_WORKFLOW_BOUNDS.maxRepeatNesting} deep`;
  }
  const forClause = input.for;
  let templateSources = sources;
  if (isPlainObject(forClause)) {
    if (typeof forClause.$ref === 'string') {
      const problem = checkSource(forClause.$ref, sources, state);
      if (problem) return problem;
    }
    for (const entry of Object.values(forClause)) {
      const problem = checkValue(entry, depth + 2, sources, state);
      if (problem) return problem;
    }
    if (typeof forClause.as === 'string') templateSources = new Set([...sources, forClause.as]);
  }
  for (const [key, entry] of Object.entries(input)) {
    if (key === 'for' && isPlainObject(entry)) continue;
    if (key !== 'template' || !isPlainObject(entry)) {
      const problem = checkValue(entry, depth + 1, sources, state);
      if (problem) return problem;
      continue;
    }
    for (const [templateKey, templateEntry] of Object.entries(entry)) {
      const problem =
        templateKey === 'input'
          ? checkStepInput(entry.$type, templateEntry, depth + 2, templateSources, state, repeatDepth + 1)
          : checkValue(templateEntry, depth + 2, templateSources, state);
      if (problem) return problem;
    }
  }
  return null;
}

/** The host's wire schema, mirrored: exact keys, types and sizes. No `errorCode`. */
function isWellFormedBody(body: unknown): body is {
  steps: Array<{ name?: string; $type: string; input: Record<string, unknown>; suppressOutput?: boolean }>;
  arguments?: Record<string, unknown>;
} {
  if (!isPlainObject(body) || !Object.keys(body).every((key) => BODY_KEYS.has(key))) return false;
  if (!Array.isArray(body.steps) || body.steps.length === 0) return false;
  if (body.arguments !== undefined && !isPlainObject(body.arguments)) return false;
  let bytes = body.arguments ? JSON.stringify(body.arguments).length : 0;
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
    bytes += JSON.stringify(input).length;
  }
  return bytes <= MOCK_WORKFLOW_BOUNDS.maxInputBytes;
}

/**
 * The refusal for a `kind: 'workflow'` body, or `null` for one the mock will
 * price and run. In the host's order:
 *
 *  1. the wire shape — no `errorCode`, the host's schema rejection;
 *  2. the step cap — `workflow_too_many_steps`;
 *  3. step by step, the name rules and the reference graph —
 *     `workflow_ref_invalid`. A name is `[a-z][a-z0-9_-]{0,31}` (or the step's
 *     own `$<index>`), unique, and not `block-step`; a reference names
 *     `$arguments` or an EARLIER step;
 *  4. the step-type denylist on every step and on the step a `repeat` runs —
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
  const state: WalkState = { refs: 0 };
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
    if (types === null) {
      return invalid(index, `repeat steps may nest at most ${MOCK_WORKFLOW_BOUNDS.maxRepeatNesting} deep`);
    }
    const problem = checkStepInput(step.$type, step.input, 0, earlier, state, 0);
    if (problem) return invalid(index, problem);

    taken.add(name);
    earlier.add(name);
    stepTypes.push(types);
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
