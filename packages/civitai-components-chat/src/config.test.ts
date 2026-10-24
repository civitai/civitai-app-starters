import { afterEach, describe, expect, it } from 'vitest';

import { chatConfig, configureChat, onSite, outputTokenCap } from './config.js';
import { ModelDirectory } from './store/models.js';

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

describe('links to civitai.com or civitai.red', () => {
  it("point the assistant's links at the viewer's site, either way, and leave Civitai's other hosts alone", () => {
    const text = 'See https://civitai.com/models/1 and https://www.civitai.red/posts/2, built on https://mcp.civitai.com/mcp (civitai.community).';
    expect(onSite(text, 'https://civitai.red')).toBe('See https://civitai.red/models/1 and https://civitai.red/posts/2, built on https://mcp.civitai.com/mcp (civitai.community).');
    expect(onSite(text, 'https://civitai.com')).toBe('See https://civitai.com/models/1 and https://civitai.com/posts/2, built on https://mcp.civitai.com/mcp (civitai.community).');
  });

  it("follows the mature-content setting on a model card's link, also after the card loaded", async () => {
    let allowMature = false;
    const models = new ModelDirectory({ get: async () => ({ name: 'Juggernaut', modelVersions: [] }) } as never, () => allowMature);

    expect((await models.get(7)).href).toBe('https://civitai.com/models/7');
    allowMature = true;
    expect((await models.get(7)).href).toBe('https://civitai.red/models/7');
  });
});
