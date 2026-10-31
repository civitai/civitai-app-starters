import { describe, expect, it } from 'vitest';

import { voiceLanguage } from './languages.js';

describe('voiceLanguage', () => {
  it("keeps the viewer's own choice", () => {
    expect(voiceLanguage('ja', ['en-US'])).toBe('ja');
  });

  it("otherwise takes the first of the browser's languages the model knows, not just the first one", () => {
    expect(voiceLanguage(undefined, ['fy-NL', 'nl-NL', 'en-GB'])).toBe('nl');
  });

  it('falls back to English for a choice or browser the model cannot follow', () => {
    expect(voiceLanguage('sw', ['sw-KE', 'tr'])).toBe('en');
  });
});
