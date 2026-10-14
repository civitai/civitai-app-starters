import { afterEach, describe, expect, it } from 'vitest';

import { chatConfig, configureChat, outputTokenCap } from './config.js';

describe('outputTokenCap', () => {
  const pageDefault = chatConfig.maxOutputTokens;
  afterEach(() => configureChat({ maxOutputTokens: pageDefault }));

  it('defaults to 16,384 tokens when nobody set one', () => {
    expect(chatConfig.maxOutputTokens).toBe(16_384);
    expect(outputTokenCap()).toBe(16_384);
    expect(outputTokenCap(undefined)).toBe(16_384);
  });

  it("keeps the viewer's own value within 1,024 to 32,768, rounded", () => {
    expect(outputTokenCap(1_024)).toBe(1_024);
    expect(outputTokenCap(1_023)).toBe(1_024);
    expect(outputTokenCap(1_200)).toBe(1_200);
    expect(outputTokenCap(5_000.6)).toBe(5_001);
    expect(outputTokenCap(32_768)).toBe(32_768);
    expect(outputTokenCap(32_769)).toBe(32_768);
    expect(outputTokenCap(-5)).toBe(1_024);
  });

  it('falls back to the default for anything that is not a number', () => {
    for (const stale of ['8192', 'lots', null, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) expect(outputTokenCap(stale)).toBe(16_384);
  });

  it("takes the page's default from configureChat, which the viewer's own value still beats", () => {
    configureChat({ maxOutputTokens: 6_144 });
    expect(outputTokenCap()).toBe(6_144);
    expect(outputTokenCap('stale')).toBe(6_144);
    expect(outputTokenCap(2_048)).toBe(2_048);
    configureChat({ maxOutputTokens: 100_000 });
    expect(outputTokenCap()).toBe(32_768);
  });
});
