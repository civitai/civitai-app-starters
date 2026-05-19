import { describe, expect, it } from 'vitest';
import {
  TokenScope,
  TokenScopePresets,
  bitmaskFromScopes,
  getScopeLabel,
  hasScope,
  scopesFromBitmask,
} from '../src/scopes/index.js';

describe('TokenScope constants', () => {
  it('matches the documented bit values', () => {
    expect(TokenScope.UserRead).toBe(1);
    expect(TokenScope.AIServicesWrite).toBe(32768);
    expect(TokenScope.BuzzRead).toBe(65536);
    expect(TokenScope.Full).toBe((1 << 25) - 1);
  });

  it('Full is the union of every individual scope', () => {
    let union = 0;
    for (const [name, bit] of Object.entries(TokenScope)) {
      if (name === 'None' || name === 'Full') continue;
      union |= bit as number;
    }
    expect(union).toBe(TokenScope.Full);
  });
});

describe('hasScope', () => {
  it('returns true when the scope is set', () => {
    const mask = TokenScope.AIServicesWrite | TokenScope.BuzzRead;
    expect(hasScope(mask, TokenScope.AIServicesWrite)).toBe(true);
    expect(hasScope(mask, TokenScope.BuzzRead)).toBe(true);
  });

  it('returns false when the scope is missing', () => {
    const mask = TokenScope.AIServicesWrite;
    expect(hasScope(mask, TokenScope.BuzzRead)).toBe(false);
  });
});

describe('bitmaskFromScopes / scopesFromBitmask', () => {
  it('round-trips a list of named scopes', () => {
    const list = ['AIServicesWrite', 'BuzzRead', 'UserRead'] as const;
    const mask = bitmaskFromScopes(list);
    const back = scopesFromBitmask(mask);
    expect(back).toEqual(expect.arrayContaining(list));
    expect(back).toHaveLength(list.length);
  });

  it('preset AIServices contains AIServicesRead, AIServicesWrite, BuzzRead', () => {
    const names = scopesFromBitmask(TokenScopePresets.AIServices);
    expect(names).toEqual(
      expect.arrayContaining(['AIServicesRead', 'AIServicesWrite', 'BuzzRead']),
    );
  });

  it('empty list produces 0', () => {
    expect(bitmaskFromScopes([])).toBe(0);
  });
});

describe('getScopeLabel', () => {
  it('labels the well-known presets', () => {
    expect(getScopeLabel(TokenScopePresets.ReadOnly)).toBe('Read Only');
    expect(getScopeLabel(TokenScopePresets.Creator)).toBe('Creator');
    expect(getScopeLabel(TokenScopePresets.AIServices)).toBe('AI Services');
    expect(getScopeLabel(TokenScope.Full)).toBe('Full Access');
  });

  it('returns Custom for arbitrary masks', () => {
    expect(getScopeLabel(TokenScope.UserRead | TokenScope.BuzzRead)).toBe('Custom');
  });

  it('returns Legacy for null/undefined', () => {
    expect(getScopeLabel(null)).toBe('Legacy');
    expect(getScopeLabel(undefined)).toBe('Legacy');
  });
});
