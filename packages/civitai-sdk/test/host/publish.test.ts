import { describe, expect, it } from 'vitest';

import { createHost } from '../../src/host/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { init, mountTransport } from '../support/iframe-host.js';

const publish = (t: ReturnType<typeof createFakeTransport>) =>
  createHost(t).publishGenerationOutputs;

describe('host.publishGenerationOutputs', () => {
  it('names the workflow and the outputs, and resolves the rows the host made', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [101, 102] });

    await expect(publish(t)({ workflowId: 'wf_1', imageIndexes: [0, 2] })).resolves.toEqual([
      101, 102,
    ]);
    expect(t.sent.at(-1)).toEqual({
      type: 'PUBLISH_GENERATION_OUTPUTS',
      payload: { workflowId: 'wf_1', imageIndexes: [0, 2] },
    });
  });

  it('omits imageIndexes entirely when the caller published everything', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [7] });

    await publish(t)({ workflowId: 'wf_1' });

    expect(t.sent.at(-1)).toEqual({
      type: 'PUBLISH_GENERATION_OUTPUTS',
      payload: { workflowId: 'wf_1' },
    });
  });

  it('keeps the order the caller asked for', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [55, 44] });

    await publish(t)({ workflowId: 'wf_1', imageIndexes: [2, 0] });

    expect((t.sent.at(-1)!.payload as { imageIndexes: number[] }).imageIndexes).toEqual([2, 0]);
  });

  it('does not hand the caller’s own array to the wire', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [1] });
    const mine = [0, 1];

    await publish(t)({ workflowId: 'wf_1', imageIndexes: mine });
    mine.push(99);

    expect((t.sent.at(-1)!.payload as { imageIndexes: number[] }).imageIndexes).toEqual([0, 1]);
  });

  it('surfaces the host’s refusal as a BridgeError naming the operation', async () => {
    const t = createFakeTransport();
    t.fail('PUBLISH_GENERATION_OUTPUTS', {
      code: 'forbidden',
      message: 'block lacks ai:write:budgeted scope',
    });

    await expect(publish(t)({ workflowId: 'wf_1' })).rejects.toMatchObject({
      code: 'forbidden',
      operation: 'PUBLISH_GENERATION_OUTPUTS',
    });
  });
});

describe('host.publishGenerationOutputs — the shape IS the guarantee', () => {
  /**
   * 🔴 The message's whole security property: a block names a workflow it owns
   * and INDEXES into it, and the host resolves the urls server-side. A shape
   * that let a block name a url would let a frame at an opaque origin publish
   * an arbitrary blob under the viewer's account.
   *
   * So this asserts the payload's EXACT KEY SET, not merely that `url` is
   * absent: a check for one spelling passes the moment an implementation
   * spreads the caller's object and the smuggled key is called something else.
   */
  it('puts nothing on the wire but the workflow and its indexes', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [1] });

    await publish(t)({
      workflowId: 'wf_1',
      imageIndexes: [0],
      // Everything a caller might smuggle: the url the host must never accept,
      // the field the old bridge hook had and the host drops unread, and a
      // plain unknown.
      url: 'https://attacker.example/evil.png',
      imageUrls: ['https://attacker.example/evil.png'],
      title: 'anything',
      blockToken: 'stolen',
    } as unknown as { workflowId: string; imageIndexes: number[] });

    expect(Object.keys(t.sent.at(-1)!.payload as object).sort()).toEqual([
      'imageIndexes',
      'workflowId',
    ]);
  });

  /**
   * The host DROPS a request it cannot read, with no reply at all, and nothing
   * in this package bounds a request — so without this the call never settles.
   */
  it('refuses a missing workflowId rather than hanging on a dropped request', async () => {
    const t = createFakeTransport();

    await expect(
      publish(t)({ workflowId: '' }),
    ).rejects.toMatchObject({
      code: 'invalid',
      operation: 'PUBLISH_GENERATION_OUTPUTS',
    });
    expect(t.sent).toHaveLength(0);
  });

  /**
   * 🔴 The escalation: the host STRIPS an `imageIndexes` it cannot read, and a
   * stripped `imageIndexes` means publish every output. Each case below would
   * otherwise turn "publish these" into "publish all", irreversibly.
   */
  it.each([
    ['empty', []],
    ['negative', [-1]],
    ['fractional', [0.5]],
    ['not a number', ['0' as unknown as number]],
    ['NaN', [Number.NaN]],
    ['one bad index among good ones', [0, 1, -2]],
  ])('refuses an unusable imageIndexes (%s) rather than publishing everything', async (_, bad) => {
    const t = createFakeTransport();

    await expect(publish(t)({ workflowId: 'wf_1', imageIndexes: bad })).rejects.toMatchObject({
      code: 'invalid',
      operation: 'PUBLISH_GENERATION_OUTPUTS',
    });
    expect(t.sent).toHaveLength(0);
  });

  it('accepts index 0 — the boundary the refusal must not eat', async () => {
    const t = createFakeTransport();
    t.reply('PUBLISH_GENERATION_OUTPUTS', { imageIds: [1] });

    await expect(publish(t)({ workflowId: 'wf_1', imageIndexes: [0] })).resolves.toEqual([1]);
  });
});

describe('host.publishGenerationOutputs over the real bridge', () => {
  /**
   * The host answers with `PUBLISH_RESULT`, not the `<TYPE>_RESULT` the
   * transport derives. A wrong name never correlates, and since nothing here
   * times a request out, the call waits forever — which the fake transport,
   * keyed on the request type, cannot see.
   */
  it('reads the host’s differently-named reply', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).publishGenerationOutputs({
      workflowId: 'wf_1',
      imageIndexes: [1],
    });
    const sent = posted.at(-1)!.msg as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('PUBLISH_GENERATION_OUTPUTS');

    deliver({
      type: 'PUBLISH_RESULT',
      payload: { requestId: sent.payload.requestId, result: { imageIds: [900] } },
    });

    await expect(pending).resolves.toEqual([900]);
  });

  it('rejects when the viewer answers the host’s confirmation with no', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).publishGenerationOutputs({ workflowId: 'wf_1' });
    const sent = posted.at(-1)!.msg as { payload: { requestId: string } };
    deliver({
      type: 'PUBLISH_RESULT',
      payload: { requestId: sent.payload.requestId, error: 'publish canceled' },
    });

    await expect(pending).rejects.toMatchObject({
      name: 'BridgeError',
      operation: 'PUBLISH_GENERATION_OUTPUTS',
      message: 'publish canceled',
    });
  });

  /**
   * 🔴 `error: ''` is how the host spells "no failure", so such a reply reaches
   * the caller as a SUCCESS carrying nothing. Returning it would resolve
   * `undefined` out of a promise typed `number[]` — a lie that reads as
   * "nothing published" at a call site where something may well have been.
   */
  it('rejects a reply carrying neither image ids nor a failure', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).publishGenerationOutputs({ workflowId: 'wf_1' });
    const sent = posted.at(-1)!.msg as { payload: { requestId: string } };
    deliver({ type: 'PUBLISH_RESULT', payload: { requestId: sent.payload.requestId, error: '' } });

    await expect(pending).rejects.toMatchObject({
      code: 'malformed',
      operation: 'PUBLISH_GENERATION_OUTPUTS',
    });
    await expect(pending).rejects.toThrow(/carried no image ids/);
  });

  it('rejects ids that are not numbers rather than passing them on', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).publishGenerationOutputs({ workflowId: 'wf_1' });
    const sent = posted.at(-1)!.msg as { payload: { requestId: string } };
    deliver({
      type: 'PUBLISH_RESULT',
      payload: { requestId: sent.payload.requestId, result: { imageIds: ['101'] } },
    });

    await expect(pending).rejects.toMatchObject({ code: 'malformed' });
  });

  /** An empty publish IS a valid answer — every selected output failed to land. */
  it('resolves an empty list without complaint', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).publishGenerationOutputs({ workflowId: 'wf_1' });
    const sent = posted.at(-1)!.msg as { payload: { requestId: string } };
    deliver({
      type: 'PUBLISH_RESULT',
      payload: { requestId: sent.payload.requestId, result: { imageIds: [] } },
    });

    await expect(pending).resolves.toEqual([]);
  });

  /**
   * The waiting is the point — the host holds a confirmation in front of a
   * person. This pins that no deadline of this package's own ends it, which is
   * what an inherited protocol timeout would have done (civitai/civitai#4158
   * is that bug, in the bridge that had one).
   */
  it('keeps waiting while the viewer is still looking at the confirmation', async () => {
    const t = createFakeTransport();
    t.stall('PUBLISH_GENERATION_OUTPUTS');

    let settled = false;
    void publish(t)({ workflowId: 'wf_1' }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(settled).toBe(false);
  });

  it('ends the wait when the caller aborts, and not before', async () => {
    const t = createFakeTransport();
    t.stall('PUBLISH_GENERATION_OUTPUTS');
    const ac = new AbortController();

    const pending = publish(t)({ workflowId: 'wf_1' }, { signal: ac.signal });
    ac.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
