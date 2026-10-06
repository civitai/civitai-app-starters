import { describe, expect, it } from 'vitest';

import { parseCommand, resolveModel, suggestCommands } from './commands.js';

const models = [{ id: 'z-ai/glm-5.3-flash', label: 'Smart' }];

describe('slash commands', () => {
  it('reads a command and its argument, by name or alias, and flags names it does not know', () => {
    expect(parseCommand('/model  smart ')).toMatchObject({ command: { name: 'model' }, arg: 'smart' });
    expect(parseCommand('/new')).toMatchObject({ command: { name: 'clear' }, arg: '' });
    expect(parseCommand('/imagine a fox')).toEqual({ unknown: 'imagine' });
    expect(parseCommand('make a fox / a cat')).toBeNull();
  });

  it('suggests what a typed /prefix could become, until a space is typed', () => {
    expect(suggestCommands('/').map((c) => c.name)).toEqual(['clear', 'model', 'help']);
    expect(suggestCommands('/mo').map((c) => c.name)).toEqual(['model']);
    expect(suggestCommands('/n').map((c) => c.name)).toEqual(['clear']);
    expect(suggestCommands('/model smart')).toEqual([]);
  });

  it('picks a model by its label or id, the default by name, and anything else as a model id', () => {
    expect(resolveModel('Smart', models)).toBe('z-ai/glm-5.3-flash');
    expect(resolveModel('default', models)).toBeUndefined();
    expect(resolveModel('z-ai/glm-5.3-prime', models)).toBe('z-ai/glm-5.3-prime');
  });
});
