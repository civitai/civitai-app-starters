import { describe, expect, it } from 'vitest';

import {
  GENERATION_SOURCE_PERSISTED_MALFORMED_ERROR,
  isValidGenerationSourcePersistedResult,
  payloadValidatorFor,
  projectInboundPayload,
} from '../src/transport/validate.js';

/**
 * The transport half of `GENERATION_SOURCE_PERSISTED` (HQ task
 * app_blocks_sdk_x7dw): the validator lets every CORRELATABLE reply through so
 * none is dropped into a timeout, and the projection answers a malformed one as
 * an `error`, so no unchecked `result` reaches the hook.
 */

const RESULT = {
  url: 'https://image.civitai.com/x/original=true/a.jpeg',
  width: 832,
  height: 1216,
  imageId: 7301,
  ready: false,
};

const project = (payload: unknown) => projectInboundPayload('GENERATION_SOURCE_PERSISTED', payload);

describe('isValidGenerationSourcePersistedResult', () => {
  it('is the validator payloadValidatorFor routes GENERATION_SOURCE_PERSISTED to', () => {
    expect(payloadValidatorFor('GENERATION_SOURCE_PERSISTED')).toBe(isValidGenerationSourcePersistedResult);
  });

  it.each([
    ['a result', { requestId: 'r1', result: RESULT }],
    ['an error', { requestId: 'r1', error: 'refused' }],
    ['an empty error', { requestId: 'r1', error: '' }],
    // Malformed, but correlatable — let through so the projection can answer it.
    ['neither', { requestId: 'r1' }],
    ['a malformed result', { requestId: 'r1', result: { url: 5 } }],
    ['a non-string error', { requestId: 'r1', error: 7 }],
  ])('accepts a correlatable reply carrying %s', (_label, payload) => {
    expect(isValidGenerationSourcePersistedResult(payload)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a numeric requestId', { requestId: 5, result: RESULT }],
  ])('rejects an uncorrelatable payload: %s', (_label, payload) => {
    expect(isValidGenerationSourcePersistedResult(payload)).toBe(false);
  });
});

describe('projectInboundPayload — GENERATION_SOURCE_PERSISTED', () => {
  it('passes a well-formed result through by identity', () => {
    const payload = { requestId: 'r1', result: RESULT };
    expect(project(payload)).toBe(payload);
  });

  it('passes a string error through by identity (including an empty one)', () => {
    const a = { requestId: 'r1', error: 'refused' };
    const b = { requestId: 'r1', error: '' };
    expect(project(a)).toBe(a);
    expect(project(b)).toBe(b);
  });

  it.each([
    ['neither result nor error', {}],
    ['result null', { result: null }],
    ['url not a string', { result: { ...RESULT, url: 5 } }],
    ['url empty', { result: { ...RESULT, url: '' } }],
    ['width fractional', { result: { ...RESULT, width: 832.5 } }],
    ['height negative', { result: { ...RESULT, height: -1 } }],
    ['imageId a string', { result: { ...RESULT, imageId: '7301' } }],
    ['imageId missing', { result: { url: RESULT.url, width: 832, height: 1216, ready: true } }],
    ['ready missing', { result: { url: RESULT.url, width: 832, height: 1216, imageId: 7301 } }],
    ['ready a string', { result: { ...RESULT, ready: 'false' } }],
    ['error a number', { error: 7 }],
    ['error a number beside a valid result', { error: 7, result: RESULT }],
  ])('answers a malformed reply as an error, keeping only the requestId: %s', (_label, fields) => {
    expect(project({ requestId: 'r-mal', ...fields })).toEqual({
      requestId: 'r-mal',
      error: GENERATION_SOURCE_PERSISTED_MALFORMED_ERROR,
    });
  });

  it('names the message in the malformed-reply error', () => {
    expect(GENERATION_SOURCE_PERSISTED_MALFORMED_ERROR).toBe(
      'the host sent a malformed reply to PERSIST_GENERATION_SOURCE',
    );
  });

  it('leaves other message types alone', () => {
    const payload = { requestId: 'r1' };
    expect(projectInboundPayload('PUBLISH_RESULT', payload)).toBe(payload);
  });
});
