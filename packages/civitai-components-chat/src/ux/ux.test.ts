import { describe, expect, it } from 'vitest';

import { humanize } from './humanize.js';
import { decide } from './spending.js';

describe('decide', () => {
  it('runs on its own at or under the limit and asks above it', () => {
    expect(decide({ total: 44, variable: false }, 100)).toBe('auto');
    expect(decide({ total: 100, variable: false }, 100)).toBe('auto');
    expect(decide({ total: 101, variable: false }, 100)).toBe('confirm');
  });

  it('always asks for a metered price, and for an unknown one when the user wants to be asked', () => {
    expect(decide({ total: 1, variable: true }, 1_000)).toBe('confirm');
    expect(decide(null, 0)).toBe('confirm');
    expect(decide(null, 100)).toBe('auto');
  });

  it('lets free work run even when the user always wants to be asked', () => {
    expect(decide({ total: 0, variable: false }, 0)).toBe('auto');
  });
});

describe('humanize', () => {
  it('turns service failures into words a non-technical user can act on', () => {
    expect(humanize({ status: 402, message: 'x' }).kind).toBe('insufficient_buzz');
    expect(humanize(new Error('Prompt was blocked by moderation')).kind).toBe('blocked');
    expect(humanize({ statusCode: 401 }).kind).toBe('auth');
    expect(humanize({ status: 429 }).kind).toBe('rate_limit');
    expect(humanize(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(humanize(new Error('boom'))).toMatchObject({ kind: 'unknown', detail: 'boom' });
  });
});
