import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCK_WORKFLOW_MAX_STEPS,
  BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS,
} from '@civitai/app-sdk/blocks';
import type {
  BlockWorkflowSnapshot,
  WorkflowBody,
  WorkflowBodyWorkflowStep,
} from '@civitai/app-sdk/blocks';

import { useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import {
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import { useWorkflowBatch } from '../src/hooks/useWorkflowBatch.js';
import { MOCK_SPEND_SCOPE_ERROR, type MockWorkflowStepInfo } from '../src/internal/mockHost.js';
import {
  MOCK_MERGE_SHAPE_ERROR,
  MOCK_REPEAT_SHAPE_ERROR,
  MOCK_WORKFLOW_BOUNDS,
  MOCK_WORKFLOW_DENIED_STEP_TYPES,
  mockWorkflowBodyRefusal,
} from '../src/internal/mockWorkflowGraph.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The multi-step `kind: 'workflow'` body against `createMockHost`, driven
 * through the REAL hooks and transport: estimate, submit, poll, a partial
 * failure, each refusal code, a batch-estimate cell and `useWorkflowBatch`.
 */

const ORIGIN = window.location.origin;
const FAST = { intervalMs: 1, waitSeconds: 0 } as const;

/** Pairwise-distinct step prices and a fee equal to none of them or their sums. */
const PRICE: Record<string, number> = { draw: 5, cut: 11, up: 23 };
const FEE = 7;
const costPerGen = (_b: WorkflowBody, step?: MockWorkflowStepInfo) =>
  step ? (PRICE[step.name] ?? 100) : 1000;

const step = (
  name: string | undefined,
  input: Record<string, unknown> = {},
  extra: Partial<WorkflowBodyWorkflowStep> = {},
): WorkflowBodyWorkflowStep => ({
  ...(name === undefined ? {} : { name }),
  $type: 'imageGen',
  input,
  ...extra,
});
const workflow = (steps: WorkflowBodyWorkflowStep[], args?: Record<string, unknown>): WorkflowBody => ({
  kind: 'workflow',
  steps,
  ...(args ? { arguments: args } : {}),
});

/** draw (hidden) → cut (reads draw) → up (reads cut). */
const chain = (): WorkflowBody =>
  workflow(
    [
      step('draw', { prompt: { $ref: '$arguments', path: 'prompt' } }, { suppressOutput: true }),
      step('cut', { image: { $ref: 'draw', path: 'output.images[0].url' } }),
      step('up', { image: { $ref: 'cut', path: 'output.image.url' } }),
    ],
    { prompt: 'a lighthouse' },
  );

describe('createMockHost — kind: workflow', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  async function setup(options: Parameters<typeof createMockHost>[0] = {}) {
    const host = createMockHost({ consentGranted: true, ...options });
    uninstall = host.install();
    const { result } = renderHook(() => {
      const [ids, setIds] = useState<string[]>([]);
      return {
        ids,
        setIds,
        flow: useBuzzWorkflow(),
        batchEstimate: useBatchEstimate(),
        batch: useWorkflowBatch(ids, FAST),
      };
    });
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const estimate = async (body: WorkflowBody) => {
      let out: BlockWorkflowSnapshot | Error | undefined;
      await act(async () => {
        out = await result.current.flow.estimate(body).catch((e: Error) => e);
      });
      return out!;
    };
    const submit = async (body: WorkflowBody) => {
      let out: BlockWorkflowSnapshot | Error | undefined;
      await act(async () => {
        out = await result.current.flow.submit(body).catch((e: Error) => e);
      });
      return out!;
    };
    const poll = async (id: string) => {
      let out: BlockWorkflowSnapshot | undefined;
      await act(async () => {
        out = await result.current.flow.poll(id);
      });
      return out!;
    };
    return { host, result, estimate, submit, poll };
  }

  // ---------------------------------------------------------------- copies

  it('holds its step cap to the SDK constant', () => {
    expect(MOCK_WORKFLOW_BOUNDS.maxSteps).toBe(BLOCK_WORKFLOW_MAX_STEPS);
    expect(BLOCK_WORKFLOW_MAX_STEPS).toBe(8);
    expect(MOCK_WORKFLOW_BOUNDS.maxRepeatIterations).toBe(BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS);
    expect(BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS).toBe(16);
  });

  it('denies exactly the host platform-internal list plus promptModeration', () => {
    expect([...MOCK_WORKFLOW_DENIED_STEP_TYPES].sort()).toEqual(
      [
        'comfyNodepackSnapshot',
        'imageScanning',
        'mediaHash',
        'modelClamScan',
        'modelHash',
        'modelParseMetadata',
        'modelPickleScan',
        'promptModeration',
        'qwenImageBench',
        'shieldstralModeration',
        'textToImage',
        'webScrape',
        'webSearch',
        'xGuardModeration',
      ].sort(),
    );
  });

  // -------------------------------------------------------------- estimate

  describe('estimate', () => {
    it('prices the sum of the per-step costs plus ONE author fee, itemised', async () => {
      const { estimate } = await setup({ generation: { costPerGen, authorFee: FEE } });
      const quote = (await estimate(chain())) as BlockWorkflowSnapshot;
      // 5 + 11 + 23 = 39 for the steps; 7 once, not 21.
      expect(quote.cost).toEqual({ total: 46, authorFee: 7 });
      expect(quote.status).toBe('pending');
      expect(quote.steps).toBeUndefined();
    });

    it('a plain-number costPerGen prices each step at that number; the fee is still charged once', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 9, authorFee: FEE } });
      expect(((await estimate(chain())) as BlockWorkflowSnapshot).cost).toEqual({
        total: 3 * 9 + 7,
        authorFee: 7,
      });
    });

    it('authorFee: false leaves the fee out of the quote entirely', async () => {
      const { estimate } = await setup({ generation: { costPerGen, authorFee: false } });
      expect(((await estimate(chain())) as BlockWorkflowSnapshot).cost).toEqual({ total: 39 });
    });

    it('calls costPerGen once per step, with the step as the second argument', async () => {
      const seen: MockWorkflowStepInfo[] = [];
      const { estimate } = await setup({
        generation: {
          costPerGen: (_b, s) => {
            if (s) seen.push(s);
            return 1;
          },
        },
      });
      await estimate(workflow([step('draw', { a: 1 }), step(undefined, { b: 2 }, { $type: 'echo' })]));
      expect(seen).toEqual([
        { index: 0, name: 'draw', $type: 'imageGen', input: { a: 1 } },
        { index: 1, name: '$1', $type: 'echo', input: { b: 2 } },
      ]);
    });

    it('a single-kind body is still priced with one call and no step argument', async () => {
      const { estimate } = await setup({ generation: { costPerGen, authorFee: FEE } });
      const single = await estimate({
        kind: 'textToImage',
        modelId: 1,
        modelVersionId: 2,
        params: { prompt: 'x' },
      });
      expect((single as BlockWorkflowSnapshot).cost).toEqual({ total: 1007, authorFee: 7 });
    });
  });

  // -------------------------------------------------------------- refusals

  /** Asserts `out` is an estimate refusal carrying exactly `code`, with no price. */
  const expectEstimateRefusal = (out: unknown, code: string | undefined) => {
    expect(out).toBeInstanceOf(WorkflowEstimateError);
    const snapshot = (out as WorkflowEstimateError).snapshot;
    expect(snapshot).toMatchObject({ workflowId: 'failed', status: 'failed' });
    expect(snapshot.errorCode).toBe(code);
    expect(snapshot.cost).toBeUndefined();
    return snapshot;
  };

  describe('workflow_too_many_steps', () => {
    const many = (n: number) => workflow(Array.from({ length: n }, (_, i) => step(`s${i}`)));

    it('refuses 9 steps on estimate', async () => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(many(9)), 'workflow_too_many_steps');
      expect(snapshot.error).toBe('a workflow may have at most 8 steps (got 9)');
    });

    it('prices 8 steps — the boundary is inclusive', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 3, authorFee: FEE } });
      expect(((await estimate(many(8))) as BlockWorkflowSnapshot).cost).toEqual({
        total: 8 * 3 + 7,
        authorFee: 7,
      });
    });

    it('refuses an empty step list without a code (a schema rejection)', async () => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(workflow([])), undefined);
      expect(snapshot.error).toBe('invalid workflow body');
    });
  });

  describe('the wire shape (a schema rejection: no errorCode)', () => {
    it.each([
      ['an unknown body key', { kind: 'workflow', steps: [step('a')], maxBuzz: 10 }],
      ['an unknown step key', { kind: 'workflow', steps: [{ ...step('a'), timeout: 5 }] }],
      ['a step with no input', { kind: 'workflow', steps: [{ name: 'a', $type: 'echo' }] }],
      ['an empty $type', { kind: 'workflow', steps: [step('a', {}, { $type: '' })] }],
      ['a 65-character $type', { kind: 'workflow', steps: [step('a', {}, { $type: 'x'.repeat(65) })] }],
      ['a non-boolean suppressOutput', { kind: 'workflow', steps: [{ ...step('a'), suppressOutput: 'yes' }] }],
      ['arguments that is not an object', { kind: 'workflow', steps: [step('a')], arguments: ['x'] }],
      ['inputs over the byte limit', { kind: 'workflow', steps: [step('a', { blob: 'x'.repeat(262_144) })] }],
    ])('refuses %s', async (_, body) => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(body as WorkflowBody), undefined);
      expect(snapshot.error).toBe('invalid workflow body');
    });

    it('accepts a 64-character $type and inputs just under the byte limit', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 4 } });
      const body = workflow([step('a', { blob: 'x'.repeat(262_000) }, { $type: 'x'.repeat(64) })]);
      expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(4);
    });
  });

  describe('workflow_step_denied', () => {
    it.each(MOCK_WORKFLOW_DENIED_STEP_TYPES.map((t) => [t]))('refuses $type %s', async ($type) => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(
        await estimate(workflow([step('draw'), step('bad', {}, { $type })])),
        'workflow_step_denied',
      );
      expect(snapshot.error).toBe(
        `workflow step 1: orchestrator step type '${$type}' is platform-internal and cannot be submitted by an app block`,
      );
    });

    it('matches case-insensitively, as the host does', async () => {
      const { estimate } = await setup();
      expectEstimateRefusal(
        await estimate(workflow([step('bad', {}, { $type: 'XGUARDMODERATION' })])),
        'workflow_step_denied',
      );
    });

    it('refuses a denied $type hidden in a repeat template', async () => {
      const { estimate } = await setup();
      const body = workflow(
        [
          step(
            'each',
            {
              for: { $ref: '$arguments', path: 'urls', as: 'u' },
              template: { $type: 'webScrape', input: { url: { $ref: 'u', path: '' } } },
            },
            { $type: 'repeat' },
          ),
        ],
        { urls: ['https://a', 'https://b'] },
      );
      expectEstimateRefusal(await estimate(body), 'workflow_step_denied');
    });

    it.each([['imageGen'], ['imageUpscaler'], ['training'], ['ageClassification'], ['aStepTypeNobodyHasHeardOf']])(
      'accepts $type %s — a denylist, not an allowlist',
      async ($type) => {
        const { estimate } = await setup({ generation: { costPerGen: 4 } });
        const quote = await estimate(workflow([step('only', {}, { $type })]));
        expect((quote as BlockWorkflowSnapshot).cost?.total).toBe(4);
      },
    );
  });

  describe('workflow_ref_invalid', () => {
    const ref = (target: unknown, path: unknown = 'output') => ({ $ref: target, path });
    const missing = (target: string) =>
      `"$ref": ${JSON.stringify(target)} does not name "$arguments" or an earlier step`;
    /** Three NAMED steps a, b, c; `input` is placed on step b (index 1). */
    const onB = (input: Record<string, unknown>) => workflow([step('a'), step('b', input), step('c')]);
    /** Three UNNAMED steps ($0, $1, $2); `input` is placed on the middle one. */
    const onMiddle = (input: Record<string, unknown>) =>
      workflow([step(undefined), step(undefined, input), step(undefined)]);

    it.each([
      ['a LATER step', { x: ref('c') }, missing('c')],
      ['ITSELF', { x: ref('b') }, missing('b')],
      ['a step that does not exist', { x: ref('nope') }, missing('nope')],
      // A NAMED step is referenced by its name only: `$0` names nothing here.
      ['a named earlier step by position', { x: ref('$0') }, missing('$0')],
      ['an earlier step in a $name spelling', { x: ref('$a') }, missing('$a')],
      ['a non-string $ref', { x: ref(0) }, 'a reference needs a string "$ref" and a string "path"'],
      ['a non-string path', { x: ref('a', 3) }, 'a reference needs a string "$ref" and a string "path"'],
      ['a non-string format', { x: { ...ref('a'), format: 5 } }, 'a reference "format" must be a string'],
      ['a bad reference nested in arrays and objects', { x: [{ y: [1, { z: ref('c') }] }] }, missing('c')],
    ])('refuses %s', async (_, input, reason) => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(onB(input)), 'workflow_ref_invalid');
      expect(snapshot.error).toBe(`workflow step 1: ${reason}`);
    });

    it.each([
      ['its own position', { x: ref('$1') }, missing('$1')],
      ['a later position', { x: ref('$2') }, missing('$2')],
      ['a position past the end', { x: ref('$7') }, missing('$7')],
    ])('refuses an unnamed step referencing %s', async (_, input, reason) => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(onMiddle(input)), 'workflow_ref_invalid');
      expect(snapshot.error).toBe(`workflow step 1: ${reason}`);
    });

    it('refuses the first step referencing anything but $arguments', async () => {
      const { estimate } = await setup();
      expectEstimateRefusal(
        await estimate(workflow([step(undefined, { x: ref('$0') })])),
        'workflow_ref_invalid',
      );
    });

    it.each([
      ['$arguments', onB({ x: ref('$arguments', 'prompt') })],
      ['an earlier step by name', onB({ x: ref('a') })],
      ['an earlier UNNAMED step by position', onMiddle({ x: ref('$0') })],
      ['the optional default and format fields', onB({ x: { $ref: 'a', path: 'o', default: null, format: '{0}' } })],
      ['good references nested in arrays and objects', onB({ x: [{ y: [1, { z: ref('a') }] }] })],
      ['no references at all', onB({ x: 1, y: 'plain', z: [true, null] })],
      // Not references, so not judged: `$ref` without `path`, and a key beyond the four.
      ['an object with $ref but no path', onB({ x: { $ref: 'c' } })],
      ['an object with $ref, path and an extra key', onB({ x: { $ref: 'c', path: 'o', extra: 1 } })],
    ])('accepts %s', async (_, body) => {
      const { estimate } = await setup({ generation: { costPerGen: 2 } });
      expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(6);
    });

    describe('step names', () => {
      it.each([
        ['an uppercase name', [step('Draw')], 'workflow step 0: name "Draw" must match ^[a-z][a-z0-9_-]{0,31}$ or be "$0"'],
        ['a 33-character name', [step('a'.repeat(33))], `workflow step 0: name "${'a'.repeat(33)}" must match ^[a-z][a-z0-9_-]{0,31}$ or be "$0"`],
        ["another step's position", [step('$1'), step('b')], 'workflow step 0: name "$1" must match ^[a-z][a-z0-9_-]{0,31}$ or be "$0"'],
        ['the reserved name', [step('block-step')], 'workflow step 0: name "block-step" is reserved'],
        ['a name used twice', [step('a'), step('a')], 'workflow step 1: name "a" is used twice'],
      ])('refuses %s', async (_, steps, error) => {
        const { estimate } = await setup();
        const snapshot = expectEstimateRefusal(await estimate(workflow(steps)), 'workflow_ref_invalid');
        expect(snapshot.error).toBe(error);
      });

      it('accepts a 32-character name and a step named by its own position', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const body = workflow([step('$0'), step('a'.repeat(32), { x: ref('$0') })]);
        expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(4);
      });
    });

    describe('limits', () => {
      const refs = (n: number) => ({ x: Array.from({ length: n }, () => ref('a')) });
      const nested = (levels: number) => {
        let value: unknown = 1;
        for (let i = 0; i < levels; i += 1) value = { v: value };
        return value as Record<string, unknown>;
      };

      it('refuses the 65th reference and accepts 64', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const over = expectEstimateRefusal(await estimate(onB(refs(65))), 'workflow_ref_invalid');
        expect(over.error).toBe('workflow step 1: a workflow may hold at most 64 references');
        expect(((await estimate(onB(refs(64)))) as BlockWorkflowSnapshot).cost?.total).toBe(6);
      });

      it('refuses an input nested past 32 levels and accepts one at the bound', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const over = expectEstimateRefusal(await estimate(onB(nested(34))), 'workflow_ref_invalid');
        expect(over.error).toBe('workflow step 1: input is nested deeper than 32 levels');
        expect(((await estimate(onB(nested(33)))) as BlockWorkflowSnapshot).cost?.total).toBe(6);
      });
    });

    describe('merge', () => {
      const merge = (fields: unknown) => step('m', { fields }, { $type: 'merge' });
      const field = (src: unknown) => ({ $ref: src, reduce: 'concat' });

      it('accepts fields reading $arguments and earlier steps', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const body = workflow([step('a'), merge({ x: field('a'), y: field('$arguments') })], { k: 1 });
        expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(4);
      });

      it.each([
        ['a field reading a LATER step', [merge({ x: field('z') }), step('z')], 'workflow step 0: "$ref": "z" does not name "$arguments" or an earlier step'],
        ['a field reading ITSELF', [step('a'), merge({ x: field('m') })], 'workflow step 1: "$ref": "m" does not name "$arguments" or an earlier step'],
        ['a field with no reduce', [step('a'), merge({ x: { $ref: 'a' } })], `workflow step 1: ${MOCK_MERGE_SHAPE_ERROR}`],
        ['a field with a non-string $ref', [step('a'), merge({ x: field(1) })], `workflow step 1: ${MOCK_MERGE_SHAPE_ERROR}`],
        ['fields that is not an object', [step('a'), merge([field('a')])], `workflow step 1: ${MOCK_MERGE_SHAPE_ERROR}`],
        ['a re-cased fields key', [step('a'), step('m', { Fields: { x: field('a') } }, { $type: 'merge' })], `workflow step 1: ${MOCK_MERGE_SHAPE_ERROR}`],
      ])('refuses %s', async (_, steps, error) => {
        const { estimate } = await setup();
        const snapshot = expectEstimateRefusal(await estimate(workflow(steps)), 'workflow_ref_invalid');
        expect(snapshot.error).toBe(error);
      });

      it('refuses a field reading a repeat variable', async () => {
        const { estimate } = await setup();
        const body = workflow(
          [
            step(
              'each',
              {
                for: { $ref: '$arguments', path: 'xs', as: 'x' },
                template: { $type: 'merge', input: { fields: { f: field('x') } } },
              },
              { $type: 'repeat' },
            ),
          ],
          { xs: [1, 2] },
        );
        const snapshot = expectEstimateRefusal(await estimate(body), 'workflow_ref_invalid');
        expect(snapshot.error).toBe('workflow step 0: a merge field cannot read the repeat variable "x"');
      });

      it('counts merge sources toward the 64-reference cap', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const fields = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [`f${k}`, field('a')]));
        const over = expectEstimateRefusal(
          await estimate(workflow([step('a'), merge(fields(65))])),
          'workflow_ref_invalid',
        );
        expect(over.error).toBe('workflow step 1: a workflow may hold at most 64 references');
        expect(((await estimate(workflow([step('a'), merge(fields(64))]))) as BlockWorkflowSnapshot).cost?.total).toBe(4);
      });
    });

    describe('repeat shape', () => {
      it.each([
        ['an extra input key', { for: { $ref: '$arguments', path: 'xs', as: 'x' }, template: { $type: 'echo' }, extra: 1 }],
        ['an extra for key', { for: { $ref: '$arguments', path: 'xs', as: 'x', limit: 2 }, template: { $type: 'echo' } }],
        ['a missing as', { for: { $ref: '$arguments', path: 'xs' }, template: { $type: 'echo' } }],
        ['an extra template key', { for: { $ref: '$arguments', path: 'xs', as: 'x' }, template: { $type: 'echo', timeout: '1s' } }],
        ['a non-string template name', { for: { $ref: '$arguments', path: 'xs', as: 'x' }, template: { $type: 'echo', name: 3 } }],
        ['no template', { for: { $ref: '$arguments', path: 'xs', as: 'x' } }],
      ])('refuses %s', async (_, input) => {
        const { estimate } = await setup();
        const snapshot = expectEstimateRefusal(
          await estimate(workflow([step('r', input, { $type: 'repeat' })], { xs: [1] })),
          'workflow_ref_invalid',
        );
        expect(snapshot.error).toBe(`workflow step 0: ${MOCK_REPEAT_SHAPE_ERROR}`);
      });

      const nest = (levels: number): { $type: string; input: Record<string, unknown> } =>
        levels === 0
          ? { $type: 'echo', input: {} }
          : { $type: 'repeat', input: { for: { $ref: '$arguments', path: 'xs', as: `x${levels}` }, template: nest(levels - 1) } };

      it('refuses repeats nested 5 deep and accepts 4', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const deep = expectEstimateRefusal(
          await estimate(workflow([{ name: 'r', ...nest(5) }], { xs: [1] })),
          'workflow_ref_invalid',
        );
        expect(deep.error).toBe(`workflow step 0: ${MOCK_REPEAT_SHAPE_ERROR}`);
        expect(((await estimate(workflow([{ name: 'r', ...nest(4) }], { xs: [1] }))) as BlockWorkflowSnapshot).cost?.total).toBe(2);
      });

      it('refuses an `as` name that is also a step name', async () => {
        const { estimate } = await setup();
        const body = workflow(
          [
            step('a'),
            step('r', { for: { $ref: '$arguments', path: 'xs', as: 'a' }, template: { $type: 'echo' } }, { $type: 'repeat' }),
          ],
          { xs: [1] },
        );
        const snapshot = expectEstimateRefusal(await estimate(body), 'workflow_ref_invalid');
        expect(snapshot.error).toBe('a repeat "as" name "a" is also a step name or "$arguments"');
      });

      it('lets the template read its own iteration variable, and refuses a later step', async () => {
        const { estimate } = await setup({ generation: { costPerGen: 2 } });
        const body = (templateRef: string) =>
          workflow(
            [
              step('r', {
                for: { $ref: '$arguments', path: 'xs', as: 'x' },
                template: { $type: 'imageUpscaler', input: { image: { $ref: templateRef, path: 'url' } } },
              }, { $type: 'repeat' }),
              step('after'),
            ],
            { xs: [1, 2, 3] },
          );
        // 3 iterations × 2 + the plain step's 2.
        expect(((await estimate(body('x'))) as BlockWorkflowSnapshot).cost?.total).toBe(8);
        expectEstimateRefusal(await estimate(body('after')), 'workflow_ref_invalid');
      });
    });
  });

  describe('workflow_repeat_unbounded', () => {
    const repeatOver = (forClause: Record<string, unknown>, template: Record<string, unknown> = { $type: 'echo' }) =>
      step('r', { for: { as: 'x', ...forClause }, template }, { $type: 'repeat' });

    it.each([
      [
        'a repeat over an EARLIER step’s output',
        workflow([step('frames'), repeatOver({ $ref: 'frames', path: 'output.frames' })]),
        `workflow step 1: a repeat may only iterate over the workflow's own arguments ("$ref": "$arguments"), not "frames" — pass the list in "arguments" instead`,
      ],
      [
        'a path missing from arguments',
        workflow([repeatOver({ $ref: '$arguments', path: 'nope' })], { xs: [1] }),
        'workflow step 0: repeat "for" path "nope" does not name an array in "arguments"',
      ],
      [
        'a path naming a non-array',
        workflow([repeatOver({ $ref: '$arguments', path: 'xs' })], { xs: 'abc' }),
        'workflow step 0: repeat "for" path "xs" does not name an array in "arguments"',
      ],
      [
        'a body with no arguments at all',
        workflow([repeatOver({ $ref: '$arguments', path: 'xs' })]),
        'workflow step 0: repeat "for" path "xs" does not name an array in "arguments"',
      ],
      [
        '17 iterations',
        workflow([repeatOver({ $ref: '$arguments', path: 'xs' })], { xs: Array.from({ length: 17 }, (_, k) => k) }),
        'workflow step 0: a repeat may run at most 16 iterations, nested repeats multiplied (got 17)',
      ],
      [
        'nested repeats whose product exceeds 16 (5 × 4)',
        workflow(
          [repeatOver({ $ref: '$arguments', path: 'outer' }, {
            $type: 'repeat',
            input: { for: { $ref: '$arguments', path: 'inner', as: 'y' }, template: { $type: 'echo' } },
          })],
          { outer: [1, 2, 3, 4, 5], inner: [1, 2, 3, 4] },
        ),
        'workflow step 0: a repeat may run at most 16 iterations, nested repeats multiplied (got 20)',
      ],
    ])('refuses %s', async (_, body, error) => {
      const { estimate } = await setup();
      const snapshot = expectEstimateRefusal(await estimate(body), 'workflow_repeat_unbounded');
      expect(snapshot.error).toBe(error);
    });

    it('accepts 16 iterations, nested repeats multiplied (4 × 4), and prices every child', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 3, authorFee: FEE } });
      const body = workflow(
        [repeatOver({ $ref: '$arguments', path: 'outer' }, {
          $type: 'repeat',
          input: { for: { $ref: '$arguments', path: 'inner', as: 'y' }, template: { $type: 'echo' } },
        })],
        { outer: [1, 2, 3, 4], inner: [1, 2, 3, 4] },
      );
      expect(((await estimate(body)) as BlockWorkflowSnapshot).cost).toEqual({ total: 16 * 3 + 7, authorFee: 7 });
    });

    it('accepts a dotted path into arguments', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 1 } });
      const body = workflow([repeatOver({ $ref: '$arguments', path: 'set.items' })], { set: { items: [1, 2] } });
      expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(2);
    });

    it('is refused on submit too, before anything is debited', async () => {
      const { host, submit } = await setup({ buzz: { balance: 500 } });
      const out = await submit(workflow([step('frames'), repeatOver({ $ref: 'frames', path: 'output' })]));
      expect(out).toBeInstanceOf(WorkflowSubmitError);
      expect((out as WorkflowSubmitError).snapshot.errorCode).toBe('workflow_repeat_unbounded');
      expect(host.buzz.getBalance()).toBe(500);
    });
  });

  it('checks the cap, then names and references, then the denylist — the host order', () => {
    // One body that breaks all three rules reports the earliest one.
    const bad = step('bad', { x: { $ref: 'later', path: 'o' } }, { $type: 'webSearch' });
    expect(
      mockWorkflowBodyRefusal(workflow([bad, ...Array.from({ length: 8 }, () => step(undefined))]))
        ?.errorCode,
    ).toBe('workflow_too_many_steps');
    expect(mockWorkflowBodyRefusal(workflow([bad, step('later')]))?.errorCode).toBe('workflow_ref_invalid');
    const deniedOnly = step('bad', {}, { $type: 'webSearch' });
    expect(mockWorkflowBodyRefusal(workflow([deniedOnly, step('later')]))?.errorCode).toBe('workflow_step_denied');
    expect(mockWorkflowBodyRefusal(chain())).toBeNull();
  });

  // ---------------------------------------------------------------- unpriced

  describe('generation.workflowUnpriced (no quote)', () => {
    const repeatStep = (template: Record<string, unknown> = { $type: 'echo' }) =>
      step('r', { for: { $ref: '$arguments', path: 'xs', as: 'x' }, template }, { $type: 'repeat' });

    it.each([
      ['a top-level repeat', workflow([step('a'), repeatStep()], { xs: [1] }), 1],
      [
        'a repeat nested in a repeat',
        workflow(
          [repeatStep({ $type: 'repeat', input: { for: { $ref: '$arguments', path: 'xs', as: 'y' }, template: { $type: 'echo' } } })],
          { xs: [1] },
        ),
        0,
      ],
    ])('refuses %s with workflow_repeat_unbounded, before anything is debited', async (_, body, index) => {
      const { host, estimate, submit } = await setup({ buzz: { balance: 500 }, generation: { workflowUnpriced: true } });
      const snapshot = expectEstimateRefusal(await estimate(body), 'workflow_repeat_unbounded');
      expect(snapshot.error).toBe(
        `workflow step ${index}: a workflow with a repeat needs a price quote and none could be obtained; try again`,
      );
      const out = await submit(body);
      expect(out).toBeInstanceOf(WorkflowSubmitError);
      expect((out as WorkflowSubmitError).snapshot.errorCode).toBe('workflow_repeat_unbounded');
      expect(host.buzz.getBalance()).toBe(500);
    });

    it('refuses a training step (even in a repeat template) with the training code, ahead of the repeat', async () => {
      const { estimate } = await setup({ generation: { workflowUnpriced: true } });
      const body = workflow([repeatStep({ $type: 'training', input: {} })], { xs: [1] });
      const snapshot = expectEstimateRefusal(await estimate(body), 'training-quote-unavailable');
      expect(snapshot.error).toBe('Training needs a price quote and none could be obtained; try again.');
    });

    it('a workflow with neither proceeds, reserved at budget × steps with no fee', async () => {
      const { host, estimate, submit, poll } = await setup({
        buzzBudget: 50,
        buzz: { balance: 500 },
        pollsUntilDone: 1,
        generation: { workflowUnpriced: true, costPerGen, authorFee: FEE },
      });
      expect(((await estimate(chain())) as BlockWorkflowSnapshot).cost).toEqual({ total: 150, authorFee: 0 });
      const { workflowId } = (await submit(chain())) as BlockWorkflowSnapshot;
      expect(host.buzz.getBalance()).toBe(350);
      expect((await poll(workflowId)).cost).toEqual({ total: 150 });
    });

    it('a QUOTED repeat workflow is not refused', async () => {
      const { estimate } = await setup({ generation: { costPerGen: 2 } });
      expect(((await estimate(workflow([repeatStep()], { xs: [1, 2] }))) as BlockWorkflowSnapshot).cost?.total).toBe(4);
    });
  });

  // ---------------------------------------------------------------- submit

  describe('submit', () => {
    it.each([
      ['workflow_too_many_steps', workflow(Array.from({ length: 9 }, (_, i) => step(`s${i}`)))],
      ['workflow_step_denied', workflow([step('bad', {}, { $type: 'modelHash' })])],
      ['workflow_ref_invalid', workflow([step('a', { x: { $ref: 'b', path: 'o' } }), step('b')])],
    ])('refuses with %s before anything is debited or recorded', async (code, body) => {
      const { host, submit } = await setup({ buzz: { balance: 500 } });
      const out = await submit(body);
      expect(out).toBeInstanceOf(WorkflowSubmitError);
      expect((out as WorkflowSubmitError).code).toBe('exception');
      expect((out as WorkflowSubmitError).snapshot.errorCode).toBe(code);
      expect((out as WorkflowSubmitError).snapshot.cost).toBeUndefined();
      expect(host.buzz.getBalance()).toBe(500);
    });

    it('debits the step sum plus the fee ONCE, and the run reports the step sum', async () => {
      const { host, submit, poll } = await setup({
        buzz: { balance: 500 },
        pollsUntilDone: 1,
        generation: { costPerGen, authorFee: FEE },
      });
      const submitted = (await submit(chain())) as BlockWorkflowSnapshot;
      expect(submitted.status).toBe('pending');
      // 500 - (5 + 11 + 23) - 7. Charging the fee per step would leave 440.
      expect(host.buzz.getBalance()).toBe(454);
      const done = await poll(submitted.workflowId);
      expect(done.status).toBe('succeeded');
      expect(done.cost).toEqual({ total: 39 });
    });
  });

  // ------------------------------------------------------------------ poll

  describe('poll', () => {
    it('steps finish in order, one more per poll, then the workflow succeeds', async () => {
      const { submit, poll } = await setup({ pollsUntilDone: 3, generation: { costPerGen } });
      const { workflowId } = (await submit(chain())) as BlockWorkflowSnapshot;
      const statuses = (s: BlockWorkflowSnapshot) => s.steps?.map((x) => x.status);

      const first = await poll(workflowId);
      expect(first.status).toBe('processing');
      expect(statuses(first)).toEqual(['succeeded', 'processing', 'pending']);
      // `draw` is done but suppressed, so nothing is surfaced yet.
      expect(first.imageUrls).toBeUndefined();

      const second = await poll(workflowId);
      expect(second.status).toBe('processing');
      expect(statuses(second)).toEqual(['succeeded', 'succeeded', 'processing']);
      expect(second.imageUrls).toEqual(second.steps![1]!.imageUrls);

      const third = await poll(workflowId);
      expect(third.status).toBe('succeeded');
      expect(statuses(third)).toEqual(['succeeded', 'succeeded', 'succeeded']);
      expect(third.steps!.map((x) => [x.name, x.$type])).toEqual([
        ['draw', 'imageGen'],
        ['cut', 'imageGen'],
        ['up', 'imageGen'],
      ]);
    });

    it('honours suppressOutput: no step images, and absent from the top-level union', async () => {
      const { submit, poll } = await setup({
        pollsUntilDone: 1,
        generation: { images: ['https://img.test/final-1.png', 'https://img.test/final-2.png'] },
      });
      const { workflowId } = (await submit(chain())) as BlockWorkflowSnapshot;
      const done = await poll(workflowId);
      const [draw, cut, up] = done.steps!;
      expect(draw).toEqual({ name: 'draw', $type: 'imageGen', status: 'succeeded' });
      expect(cut!.imageUrls).toHaveLength(1);
      expect(cut!.imageUrls![0]).toContain('cut');
      // `generation.images` is the LAST visible step's output.
      expect(up!.imageUrls).toEqual(['https://img.test/final-1.png', 'https://img.test/final-2.png']);
      expect(done.imageUrls).toEqual([...cut!.imageUrls!, ...up!.imageUrls!]);
    });

    it('an unnamed step reports under its position', async () => {
      const { submit, poll } = await setup({ pollsUntilDone: 1 });
      const { workflowId } = (await submit(workflow([step(undefined), step('named')]))) as BlockWorkflowSnapshot;
      expect((await poll(workflowId)).steps!.map((x) => x.name)).toEqual(['$0', 'named']);
    });

    it('a single-kind workflow still carries no steps', async () => {
      const { submit, poll } = await setup({ pollsUntilDone: 2 });
      const { workflowId } = (await submit({
        kind: 'textToImage',
        modelId: 1,
        modelVersionId: 2,
        params: { prompt: 'x' },
      })) as BlockWorkflowSnapshot;
      expect((await poll(workflowId)).steps).toBeUndefined();
      expect((await poll(workflowId)).steps).toBeUndefined();
    });
  });

  // ------------------------------------------------------- partial failure

  describe('generation.failWorkflowStep', () => {
    /** All three steps visible, so the surviving images are checkable. */
    const visible = () => workflow([step('draw'), step('cut'), step('up')]);

    it('fails the named step: earlier steps stay succeeded, charged and visible', async () => {
      const { submit, poll } = await setup({
        pollsUntilDone: 2,
        generation: { costPerGen, failWorkflowStep: 'up' },
      });
      const { workflowId } = (await submit(visible())) as BlockWorkflowSnapshot;

      const running = await poll(workflowId);
      expect(running.status).toBe('processing');

      const failed = await poll(workflowId);
      expect(failed.status).toBe('failed');
      // draw (5) + cut (11) ran and stay charged; up (23) did not.
      expect(failed.cost).toEqual({ total: 16 });
      expect(failed.error).toBe('mock: step "up" failed');
      expect(failed.steps!.map((x) => x.status)).toEqual(['succeeded', 'succeeded', 'failed']);
      expect(failed.steps![2]).toEqual({
        name: 'up',
        $type: 'imageGen',
        status: 'failed',
        error: 'mock: step "up" failed',
      });
      expect(failed.imageUrls).toHaveLength(2);
      expect(failed.imageUrls).toEqual([
        ...failed.steps![0]!.imageUrls!,
        ...failed.steps![1]!.imageUrls!,
      ]);
    });

    it('names an unnamed step by position, and cancels the steps after it', async () => {
      const { submit, poll } = await setup({
        pollsUntilDone: 1,
        generation: { costPerGen, failWorkflowStep: '$1' },
      });
      const { workflowId } = (await submit(
        workflow([step('draw'), step(undefined), step('up')]),
      )) as BlockWorkflowSnapshot;
      const failed = await poll(workflowId);
      expect(failed.status).toBe('failed');
      expect(failed.cost).toEqual({ total: 5 });
      expect(failed.steps!.map((x) => x.status)).toEqual(['succeeded', 'failed', 'canceled']);
      expect(failed.imageUrls).toEqual(failed.steps![0]!.imageUrls);
      expect(failed.steps![2]!.imageUrls).toBeUndefined();
    });

    it('a failing FIRST step charges nothing and surfaces nothing', async () => {
      const { submit, poll } = await setup({
        pollsUntilDone: 1,
        generation: { costPerGen, failWorkflowStep: 'draw' },
      });
      const { workflowId } = (await submit(visible())) as BlockWorkflowSnapshot;
      const failed = await poll(workflowId);
      expect(failed).toMatchObject({ status: 'failed', cost: { total: 0 } });
      expect(failed.imageUrls).toBeUndefined();
    });

    it('leaves a workflow with no such step, and every other kind, alone', async () => {
      const { submit, poll } = await setup({
        pollsUntilDone: 1,
        generation: { costPerGen, failWorkflowStep: 'missing' },
      });
      const { workflowId } = (await submit(visible())) as BlockWorkflowSnapshot;
      expect((await poll(workflowId)).status).toBe('succeeded');
    });
  });

  // ------------------------------------------------------------ spend scope

  describe('the spend-scope refusal applies to this kind too', () => {
    it('estimate is refused before the body is even looked at', async () => {
      const { estimate } = await setup({ consentGranted: false, consentGrantable: false });
      // A body that would ALSO be refused for its step count: the scope answers first.
      const out = await estimate(workflow(Array.from({ length: 9 }, (_, i) => step(`s${i}`))));
      const snapshot = expectEstimateRefusal(out, undefined);
      expect(snapshot.error).toBe(MOCK_SPEND_SCOPE_ERROR);
    });

    it('submit is refused with nothing debited', async () => {
      const { host, submit } = await setup({
        consentGranted: false,
        consentGrantable: false,
        buzz: { balance: 500 },
      });
      const out = await submit(chain());
      expect(out).toBeInstanceOf(WorkflowSubmitError);
      expect((out as WorkflowSubmitError).snapshot.error).toBe(MOCK_SPEND_SCOPE_ERROR);
      expect((out as WorkflowSubmitError).snapshot.errorCode).toBeUndefined();
      expect(host.buzz.getBalance()).toBe(500);
    });
  });

  // ----------------------------------------------------------------- batch

  it('a workflow body is ONE batch-estimate cell, priced as a single estimate of it', async () => {
    const { result } = await setup({ generation: { costPerGen, authorFee: FEE } });
    const refused = workflow([step('bad', {}, { $type: 'webScrape' })]);
    let batch: Awaited<ReturnType<typeof result.current.batchEstimate.estimateBatch>> | undefined;
    await act(async () => {
      batch = await result.current.batchEstimate.estimateBatch([
        chain(),
        { kind: 'textToImage', modelId: 1, modelVersionId: 2, params: { prompt: 'x' } },
        refused,
      ]);
    });
    const [first, second, third] = batch!.cells;
    expect(first).toMatchObject({ ok: true, cost: { total: 46, authorFee: 7 } });
    expect(second).toMatchObject({ ok: true, cost: { total: 1007, authorFee: 7 } });
    expect(third!.ok).toBe(false);
    expect(!third!.ok && third!.error.snapshot.errorCode).toBe('workflow_step_denied');
    expect(batch!.aggregate).toEqual({ total: 1053, pricedCells: 2, cellCount: 3 });
  });

  it('useWorkflowBatch follows workflow runs, counting a partial failure and its cost', async () => {
    const { result } = await setup({
      pollsUntilDone: 2,
      generation: { costPerGen, failWorkflowStep: 'cut' },
    });
    // The first run has a `cut` step and fails there; the second does not.
    for (const body of [chain(), workflow([step('draw'), step('up')])]) {
      let id = '';
      await act(async () => {
        id = (await result.current.flow.submit(body)).workflowId;
      });
      act(() => result.current.setIds((prev) => [...prev, id]));
    }
    await waitFor(() => expect(result.current.batch.summary.settled).toBe(true));
    expect(result.current.batch.summary).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1,
      // 5 (draw, before the failing cut) + 28 (draw + up).
      realisedCost: 33,
      costedCells: 2,
    });
    const failed = result.current.batch.cells.find((c) => c.snapshot?.status === 'failed');
    expect(failed?.snapshot?.steps?.map((x) => x.status)).toEqual(['succeeded', 'failed', 'canceled']);
  });
});
