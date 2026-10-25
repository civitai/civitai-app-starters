import { describe, expect, it } from 'vitest';

import { isValidResourceFileResult, payloadValidatorFor } from '../src/transport/validate.js';

/**
 * The `RESOURCE_FILE_RESULT` reply guard (civitai/civitai-app-starters#664,
 * phase 2). Like `isValidWildcardPackResult`, the error channel is a CLOSED
 * code set, so a free-text error is malformed and dropped, never surfaced.
 *
 * Every rejection case below starts from {@link REPLY}, which the first case
 * shows is ACCEPTED, and changes exactly one field. A rejection therefore
 * belongs to the field the case names, not to some other defect in the fixture.
 */

/** The seven codes, as literals. Not derived from the validator under test. */
const CODES = [
  'not-found',
  'forbidden',
  'unauthorized',
  'too-large',
  'parse-failed',
  'busy',
  'rate-limited',
];

const META = {
  modelId: 11,
  modelVersionId: 22,
  fileId: 33,
  fileName: 'workflow.zip',
  modelName: 'A workflow',
  versionName: 'v2',
  creatorUsername: 'maker',
};

const ENTRY = { path: 'graphs/upscale.json', format: 'ui', graph: { nodes: [], links: [] } };

const FILE = { meta: META, entries: [ENTRY], truncated: false };

const REPLY = { requestId: 'r-1', file: FILE };

/** {@link REPLY} with `file` rebuilt by `edit`. */
function withFile(edit: (f: Record<string, unknown>) => unknown): Record<string, unknown> {
  return { requestId: 'r-1', file: edit({ ...FILE }) };
}

/** {@link REPLY} with `file.meta` rebuilt by `edit`. */
function withMeta(edit: (m: Record<string, unknown>) => unknown): Record<string, unknown> {
  return withFile((f) => ({ ...f, meta: edit({ ...META }) }));
}

/** {@link REPLY} with the one entry rebuilt by `edit`. */
function withEntry(edit: (e: Record<string, unknown>) => unknown): Record<string, unknown> {
  return withFile((f) => ({ ...f, entries: [edit({ ...ENTRY })] }));
}

describe('isValidResourceFileResult — well-formed replies', () => {
  it('accepts a file (the base every rejection below mutates)', () => {
    expect(isValidResourceFileResult(REPLY)).toBe(true);
  });

  it.each(CODES)('accepts the `%s` error code', (code) => {
    expect(isValidResourceFileResult({ requestId: 'r-1', error: code })).toBe(true);
  });

  it('accepts each entry format', () => {
    for (const format of ['ui', 'api', 'unknown']) {
      expect(isValidResourceFileResult(withEntry((e) => ({ ...e, format })))).toBe(true);
    }
  });

  it('accepts a null creatorUsername (a deleted creator)', () => {
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, creatorUsername: null })))).toBe(true);
  });

  it('accepts an empty entries list with truncated: true', () => {
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, entries: [], truncated: true })))).toBe(
      true,
    );
  });

  it('accepts any JSON value as a graph, including null', () => {
    for (const graph of [null, [], 'x', 0, { a: { class_type: 'K', inputs: {} } }]) {
      expect(isValidResourceFileResult(withEntry((e) => ({ ...e, graph })))).toBe(true);
    }
  });
});

describe('isValidResourceFileResult — the closed error set', () => {
  it.each([
    'kaboom', // free text
    '', // empty
    'NOT_FOUND', // the tRPC spelling, not the bridge code
    'not_found', // near miss
    'Not-Found', // case
    'payload-too-large', // a plausible but undeclared code
    'unsupported', // a plausible but undeclared code
  ])('rejects the unknown code %j', (code) => {
    expect(isValidResourceFileResult({ requestId: 'r-1', error: code })).toBe(false);
  });

  it('rejects a non-string error', () => {
    expect(isValidResourceFileResult({ requestId: 'r-1', error: 404 })).toBe(false);
    expect(isValidResourceFileResult({ requestId: 'r-1', error: { code: 'busy' } })).toBe(false);
  });
});

describe('isValidResourceFileResult — malformed payloads', () => {
  it('rejects a non-object payload', () => {
    for (const p of [null, undefined, 'x', 1, []]) {
      expect(isValidResourceFileResult(p)).toBe(false);
    }
  });

  it('rejects neither-file-nor-error', () => {
    expect(isValidResourceFileResult({ requestId: 'r-1' })).toBe(false);
  });

  it('rejects a non-string requestId', () => {
    expect(isValidResourceFileResult({ ...REPLY, requestId: 7 })).toBe(false);
  });

  it('rejects a non-object file', () => {
    expect(isValidResourceFileResult({ requestId: 'r-1', file: 'workflow' })).toBe(false);
    expect(isValidResourceFileResult({ requestId: 'r-1', file: null })).toBe(false);
  });

  it('rejects a file with no meta', () => {
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, meta: undefined })))).toBe(false);
  });

  it.each(['modelId', 'modelVersionId', 'fileId'])('rejects a non-integer meta.%s', (key) => {
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, [key]: 1.5 })))).toBe(false);
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, [key]: '1' })))).toBe(false);
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, [key]: undefined })))).toBe(false);
  });

  it.each(['fileName', 'modelName', 'versionName'])('rejects a non-string meta.%s', (key) => {
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, [key]: 1 })))).toBe(false);
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, [key]: undefined })))).toBe(false);
  });

  it('rejects a creatorUsername that is neither a string nor null', () => {
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, creatorUsername: 5 })))).toBe(false);
    expect(isValidResourceFileResult(withMeta((m) => ({ ...m, creatorUsername: undefined })))).toBe(
      false,
    );
  });

  it('rejects non-array entries', () => {
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, entries: ENTRY })))).toBe(false);
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, entries: undefined })))).toBe(false);
  });

  it('rejects a non-boolean truncated', () => {
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, truncated: 'no' })))).toBe(false);
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, truncated: undefined })))).toBe(false);
  });

  it('rejects a non-object entry', () => {
    expect(isValidResourceFileResult(withFile((f) => ({ ...f, entries: ['graph.json'] })))).toBe(
      false,
    );
  });

  it('rejects an entry with a non-string path', () => {
    expect(isValidResourceFileResult(withEntry((e) => ({ ...e, path: 3 })))).toBe(false);
  });

  it('rejects an entry with an unknown format', () => {
    for (const format of ['comfy', 'UI', '', undefined]) {
      expect(isValidResourceFileResult(withEntry((e) => ({ ...e, format })))).toBe(false);
    }
  });

  it('rejects an entry with no graph key', () => {
    expect(
      isValidResourceFileResult(
        withEntry((e) => {
          const { graph: _graph, ...rest } = e;
          return rest;
        }),
      ),
    ).toBe(false);
  });

  it('checks EVERY entry, not just the first', () => {
    expect(
      isValidResourceFileResult(withFile((f) => ({ ...f, entries: [ENTRY, { ...ENTRY, path: 3 }] }))),
    ).toBe(false);
  });

  it('rejects a well-formed file paired with an unknown error code', () => {
    expect(isValidResourceFileResult({ ...REPLY, error: 'kaboom' })).toBe(false);
  });
});

describe('RESOURCE_FILE_RESULT is routed to its own validator', () => {
  it('payloadValidatorFor returns isValidResourceFileResult, by identity', () => {
    expect(payloadValidatorFor('RESOURCE_FILE_RESULT')).toBe(isValidResourceFileResult);
  });
});
