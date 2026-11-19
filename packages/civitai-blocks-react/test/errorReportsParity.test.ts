import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PARITY GUARD — `src/transport/errorReports.ts` is a PORT of `@civitai/sdk`'s
 * `src/host/dev-errors.ts`. This package does not depend on `@civitai/sdk`, so it
 * cannot import the reporter, and moving it into `@civitai/app-sdk` would cost a
 * peer-floor bump for every blocks-react consumer. Instead two REGIONS of the
 * copies are pinned to each other here: everything from `const JWT =` to the end
 * (redaction, truncation, the describe/stringify helpers) and `admit()` (dedupe and
 * rate limit), plus the cap values. NOT covered: `PRE_CAP`, `install()` (the
 * listeners and the `console.error` wrapper) and `report()` with its re-entrancy
 * guard. They sit outside both regions, and `report()` also differs by design in
 * how a report reaches the host. A change there in one copy does not go red here.
 *
 * It compares SOURCE TEXT on purpose: the property is "the same code", and the
 * parts that differ by design (how a report reaches the host) are excluded by
 * position, not by a list of allowed differences.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');
const SDK = read('../../civitai-sdk/src/host/dev-errors.ts');
const PORT = read('../src/transport/errorReports.ts');

/** From `const JWT =` to the end: redaction, truncation, and every describe/stringify helper. */
const tail = (src: string) => {
  const at = src.indexOf('\nconst JWT =');
  if (at === -1) throw new Error('marker `const JWT =` not found: the guard is reading the wrong file');
  return src.slice(at);
};

/** The `admit` function (dedupe, then the rate limit), with the constants' prefix normalised. */
const admit = (src: string, prefix: string) => {
  const match = /\nfunction admit\([\s\S]*?\n}\n/.exec(src);
  if (!match) throw new Error('`function admit` not found: the guard is reading the wrong file');
  return match[0].split(prefix).join('CAP_');
};

/** Every `export const <PREFIX>NAME = <number>;`, by NAME. */
const caps = (src: string, prefix: string) =>
  Object.fromEntries(
    [...src.matchAll(new RegExp(`export const ${prefix}(\\w+) = ([\\d_]+);`, 'g'))].map((m) => [
      m[1],
      Number(m[2]!.replace(/_/g, '')),
    ]),
  );

describe('errorReports.ts stays a faithful port of @civitai/sdk dev-errors.ts', () => {
  it('the redaction, truncation and describe helpers are byte-identical', () => {
    expect(tail(PORT)).toBe(tail(SDK));
  });

  it('the dedupe and rate limit are the same code', () => {
    expect(admit(PORT, 'ERROR_REPORT_')).toBe(admit(SDK, 'DEV_ERROR_'));
  });

  it('the caps have the same values — pinned literally too, so both cannot drift together unnoticed', () => {
    const expected = { MESSAGE_MAX: 2000, STACK_MAX: 4000, RATE_LIMIT: 20, WINDOW_MS: 60000, DEDUPE_MS: 10000 };
    expect(caps(PORT, 'ERROR_REPORT_')).toEqual(expected);
    expect(caps(SDK, 'DEV_ERROR_')).toEqual(expected);
  });
});
