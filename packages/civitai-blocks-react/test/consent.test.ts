import { describe, expect, it } from 'vitest';

import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';

import {
  consentUnavailablePayload,
  isKnownBlockScope,
  resolveUngrantableConsentNotice,
} from '../src/internal/consent.js';

/**
 * Unit coverage for the shared un-grantable-consent decision both dev hosts use.
 *
 * 🔴 This mirrors civitai/civitai's `resolveUngrantableConsentNotice`
 * (`src/components/AppBlocks/pageBlockHostLogic.ts`, #3733). The value of the
 * mirror is that `pnpm dev` and production agree; these tests are what pin the
 * agreement, so each case below names the production behaviour it copies.
 */

const GRANTED = ['models:read:self'];
const NOTHING_GRANTABLE: string[] = [];

describe('resolveUngrantableConsentNotice', () => {
  it('refuses, and NAMES the scopes, when a known scope is neither granted nor grantable', () => {
    const notice = resolveUngrantableConsentNotice(
      ['apps:storage:write', 'apps:storage:read'],
      GRANTED,
      NOTHING_GRANTABLE,
    );
    expect(notice.notify).toBe(true);
    // Sorted + deduped, mirroring the host.
    expect(notice.scopes).toEqual(['apps:storage:read', 'apps:storage:write']);
  });

  it('🔴 STILL refuses when EVERY requested scope is unknown — with scopes: []', () => {
    // The trap this whole two-field shape exists to avoid. The un-grantable set
    // is the TRIGGER as well as the payload, so filtering the trigger by the
    // vocabulary would make a request for an un-grantable scope the platform
    // doesn't recognise produce NO refusal at all — silently deleting the signal
    // in the name of sanitising it. `notify` is decided BEFORE the filter.
    const notice = resolveUngrantableConsentNotice(
      ['<img src=x onerror=alert(1)>', 'not:a:real:scope', 'A'.repeat(5000)],
      GRANTED,
      NOTHING_GRANTABLE,
    );
    expect(notice.notify).toBe(true);
    expect(notice.scopes).toEqual([]);
  });

  it('drops unknown names from the payload but keeps the known ones (mixed hint)', () => {
    // `rawScopesHint` is whatever the BLOCK's own frame posted and the payload is
    // rendered by block UI, so nothing outside the fixed vocabulary is echoed
    // back out of a host.
    const notice = resolveUngrantableConsentNotice(
      ['buzz:read:self', '<script>alert(1)</script>', 'ai:write:budgeted'],
      GRANTED,
      NOTHING_GRANTABLE,
    );
    expect(notice.notify).toBe(true);
    expect(notice.scopes).toEqual(['ai:write:budgeted', 'buzz:read:self']);
  });

  it('stays SILENT when everything requested is ALREADY granted (the benign case)', () => {
    // A refusal here would render a permission-unavailable state over a
    // permission that actually works — strictly worse than saying nothing.
    const notice = resolveUngrantableConsentNotice(
      ['models:read:self'],
      GRANTED,
      NOTHING_GRANTABLE,
    );
    expect(notice.notify).toBe(false);
    expect(notice.scopes).toEqual([]);
  });

  it('stays SILENT when the scope is still GRANTABLE via consent (not yet confirmed)', () => {
    // "The viewer has not confirmed the dialog yet" is NOT a refusal. Emitting
    // one here is the mirror-image bug: the block would give up on a grant that
    // is about to arrive.
    const notice = resolveUngrantableConsentNotice(['ai:write:budgeted'], GRANTED, [
      'ai:write:budgeted',
    ]);
    expect(notice.notify).toBe(false);
    expect(notice.scopes).toEqual([]);
  });

  it('stays SILENT on an absent / non-array / empty / non-string-only hint', () => {
    // Without an explicit requested scope proven un-grantable there is no way to
    // tell "not confirmed yet" from "never", and guessing is what produced the
    // contradictory two-message screen in the first place.
    for (const hint of [undefined, null, 'ai:write:budgeted', 42, {}, [], ['', '']]) {
      const notice = resolveUngrantableConsentNotice(hint, GRANTED, NOTHING_GRANTABLE);
      expect(notice.notify).toBe(false);
      expect(notice.scopes).toEqual([]);
    }
  });

  it('ignores non-string members but still acts on the string ones', () => {
    const notice = resolveUngrantableConsentNotice(
      [null, 42, 'buzz:read:self', undefined, { scope: 'x' }],
      GRANTED,
      NOTHING_GRANTABLE,
    );
    expect(notice.notify).toBe(true);
    expect(notice.scopes).toEqual(['buzz:read:self']);
  });

  it('does not mutate or alias the arrays it was handed', () => {
    const hint = ['buzz:read:self', 'buzz:read:self'];
    const granted = [...GRANTED];
    const notice = resolveUngrantableConsentNotice(hint, granted, NOTHING_GRANTABLE);
    expect(hint).toEqual(['buzz:read:self', 'buzz:read:self']);
    expect(granted).toEqual(GRANTED);
    expect(notice.scopes).not.toBe(hint);
  });
});

describe('isKnownBlockScope', () => {
  it('accepts every value in the canonical BLOCK_SCOPES vocabulary', () => {
    // Enumerates the DEFINING surface rather than sampling a few names, so a
    // scope added to `BLOCK_SCOPES` cannot quietly become un-nameable in a
    // refusal.
    for (const scope of Object.values(BLOCK_SCOPES)) {
      expect(isKnownBlockScope(scope)).toBe(true);
    }
  });

  it('🔴 rejects inherited Object.prototype keys (the `in` / plain-object trap)', () => {
    // Written as `scope in BLOCK_SCOPES`, or as a bare object lookup, these 12
    // inherited keys all test as "known scopes" — and the input here is
    // untrusted block-supplied text, which is what turns that into a real echo.
    // The host hit exactly this (civitai #3733). A `Set` has no prototype-chain
    // behaviour, so the class is structurally absent; this pins it.
    for (const key of [
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'valueOf',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
    ]) {
      expect(isKnownBlockScope(key)).toBe(false);
    }
  });

  it('rejects the KEYS of BLOCK_SCOPES — the vocabulary is its VALUES', () => {
    // `AI_WRITE_BUDGETED` is the constant's name; `ai:write:budgeted` is the
    // wire string. Keying the Set on the wrong one would pass every scope name
    // a block could never legitimately send and reject every one it does.
    expect(isKnownBlockScope('AI_WRITE_BUDGETED')).toBe(false);
    expect(isKnownBlockScope(BLOCK_SCOPES.AI_WRITE_BUDGETED)).toBe(true);
  });

  it('rejects markup, junk and oversized strings', () => {
    expect(isKnownBlockScope('<img src=x onerror=alert(1)>')).toBe(false);
    expect(isKnownBlockScope('not:a:real:scope')).toBe(false);
    expect(isKnownBlockScope('A'.repeat(5000))).toBe(false);
    expect(isKnownBlockScope('')).toBe(false);
  });
});

describe('consentUnavailablePayload', () => {
  it('stamps the typed reason literal and forwards the filtered scopes', () => {
    expect(consentUnavailablePayload({ notify: true, scopes: ['buzz:read:self'] })).toEqual({
      reason: 'ungrantable',
      scopes: ['buzz:read:self'],
    });
  });

  it('forwards an EMPTY scopes list unchanged (never coerces it away)', () => {
    expect(consentUnavailablePayload({ notify: true, scopes: [] })).toEqual({
      reason: 'ungrantable',
      scopes: [],
    });
  });
});
