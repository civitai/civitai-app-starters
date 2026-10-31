import { afterEach, describe, expect, it } from 'vitest';

import { chatConfig, configureChat } from '../config.js';
import { subagentSystemPrompt } from './subagents.js';
import { buildSystemPrompt, dateLine } from './system-prompt.js';

const now = new Date('2026-09-24T00:00:00Z');

const defaultName = chatConfig.name;
afterEach(() => configureChat({ name: defaultName }));

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

  it("introduces the assistant by the page's name for the chat", () => {
    configureChat({ name: 'Moodboard Chat' });
    expect(buildSystemPrompt({ now })).toContain('You are the assistant in Moodboard Chat,');
  });
});

describe('the date line', () => {
  // 03:30 UTC on Friday 2026-10-23 is still Thursday evening (22:30) in Chicago.
  const lateEvening = new Date('2026-10-23T03:30:00Z');
  const dateLines = (prompt: string) => prompt.split('\n').filter((line) => line.startsWith('Today is'));

  it("is UTC's date when the host names no zone, as before", () => {
    expect(dateLines(buildSystemPrompt({ now: lateEvening }))).toEqual(['Today is 2026-10-23.']);
    expect(dateLine(lateEvening)).toBe('Today is 2026-10-23.');
    expect(dateLine(lateEvening, '')).toBe('Today is 2026-10-23.');
    expect(dateLine(lateEvening, '   ')).toBe('Today is 2026-10-23.');
  });

  it("is the host zone's day, weekday and name, once, when it names one", () => {
    const prompt = buildSystemPrompt({ now: lateEvening, timeZone: 'America/Chicago', rules: 'You are Notes Bot.' });
    expect(dateLines(prompt)).toEqual(['Today is Thursday 2026-10-22 (America/Chicago).']);
    expect(prompt).not.toContain('2026-10-23');
    expect(dateLine(lateEvening, 'Asia/Kolkata')).toBe('Today is Friday 2026-10-23 (Asia/Kolkata).');
    expect(dateLine(lateEvening, 'UTC')).toBe('Today is Friday 2026-10-23 (UTC).');
    expect(dateLine(new Date('2026-10-22T04:59:00Z'), 'America/Chicago')).toBe('Today is Wednesday 2026-10-21 (America/Chicago).');
    expect(dateLine(new Date('2026-10-22T05:00:00Z'), 'America/Chicago')).toBe('Today is Thursday 2026-10-22 (America/Chicago).');
  });

  it("falls back to UTC's date for a zone the runtime does not know, instead of failing the reply", () => {
    expect(dateLine(lateEvening, 'Mars/Olympus_Mons')).toBe('Today is 2026-10-23.');
    expect(dateLines(buildSystemPrompt({ now: lateEvening, timeZone: 'Mars/Olympus_Mons' }))).toEqual(['Today is 2026-10-23.']);
  });

  it("gives subagents the same zone's date", () => {
    expect(dateLines(subagentSystemPrompt(['search_models'], lateEvening, undefined, 'read', 'America/Chicago'))).toEqual(['Today is Thursday 2026-10-22 (America/Chicago).']);
    expect(dateLines(subagentSystemPrompt(['search_models'], lateEvening))).toEqual(['Today is 2026-10-23.']);
  });
});
