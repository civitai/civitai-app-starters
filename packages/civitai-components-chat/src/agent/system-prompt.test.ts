import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from './system-prompt.js';

const now = new Date('2026-09-24T00:00:00Z');

describe('system prompt', () => {
  it('only offers what the assistant can do with the tools it has', () => {
    const prompt = buildSystemPrompt({ now, tools: ['search_models', 'ask_choice'] });
    expect(prompt).toContain('You cannot make or change pictures, videos or audio here');
    expect(prompt).not.toContain('run_step');
    expect(prompt).toContain('use search_models');
  });

  it("lets the embedding page replace or edit the rules while keeping the chat's context", () => {
    const replaced = buildSystemPrompt({ now, rules: 'You are Moodboard Bot.', customInstructions: 'Be brief.' });
    expect(replaced.startsWith('You are Moodboard Bot.')).toBe(true);
    expect(replaced).not.toContain('friendly creative helper');
    expect(replaced).toContain('<context> block the app adds');
    expect(replaced).toContain('<user_instructions>\nBe brief.\n</user_instructions>');

    const edited = buildSystemPrompt({ now, rules: (defaults) => defaults.replace('Civitai Chat', 'Moodboard') });
    expect(edited).toContain('You are the assistant in Moodboard');
  });
});
