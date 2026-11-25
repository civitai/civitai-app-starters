import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PARITY GUARD — `readAppDataService` (and its slug grammar and result type) in
 * `src/transport/transport.ts` is a PORT of `@civitai/sdk`'s
 * `src/core/transport.ts`. This package does not depend on `@civitai/sdk`, and the
 * SDK's `initialize()` trusts `snapshot().appData` as given, so a port that
 * accepted more than the SDK's own `snapshotFromInit` would let a value the SDK
 * rejects steer storage. Compared as SOURCE TEXT, like `errorReportsParity.test.ts`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');
const SDK = read('../../civitai-sdk/src/core/transport.ts');
const PORT = read('../src/transport/transport.ts');

const region = (src: string, re: RegExp, what: string) => {
  const match = re.exec(src);
  if (!match) throw new Error(`${what} not found: the guard is reading the wrong file`);
  return match[0];
};

/** From the slug grammar's doc comment to the end of `readAppDataService`. */
const validator = (src: string) =>
  region(
    src,
    /\/\*\* The service's own slug grammar[\s\S]*?\nexport function readAppDataService\([\s\S]*?\n}\n/,
    '`readAppDataService`',
  );

const resultType = (src: string) =>
  region(src, /\nexport interface AppDataService \{[\s\S]*?\n}\n/, '`interface AppDataService`');

describe('readAppDataService stays a faithful port of @civitai/sdk', () => {
  it('the slug grammar and the validator are byte-identical', () => {
    expect(validator(PORT)).toBe(validator(SDK));
  });

  it('the AppDataService type is byte-identical', () => {
    expect(resultType(PORT)).toBe(resultType(SDK));
  });
});
