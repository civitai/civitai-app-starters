import { describe, expect, it, vi } from 'vitest';

import { parseCommand, resolveCommands, resolveModel, suggestCommands, type ChatCommands } from './commands.js';

const models = [{ id: 'z-ai/glm-5.3-flash', label: 'Smart' }];
const run = () => undefined;
const BUILT_IN: ChatCommands = {
  clear: { aliases: ['new'], usage: '/clear', help: 'Start a new chat', run },
  model: { usage: '/model [id]', help: 'Switch model', run },
  help: { usage: '/help', help: 'List these commands', run },
};

describe('slash commands', () => {
  it('reads a command and its argument, by name or alias, and flags names it does not know', () => {
    expect(parseCommand('/model  smart ', BUILT_IN)).toMatchObject({ name: 'model', arg: 'smart' });
    expect(parseCommand('/new', BUILT_IN)).toMatchObject({ name: 'clear', arg: '' });
    expect(parseCommand('/imagine a fox', BUILT_IN)).toEqual({ unknown: 'imagine' });
    expect(parseCommand('make a fox / a cat', BUILT_IN)).toBeNull();
  });

  it('suggests what a typed /prefix could become, until a space is typed', () => {
    expect(suggestCommands('/', BUILT_IN).map((c) => c.name)).toEqual(['clear', 'model', 'help']);
    expect(suggestCommands('/mo', BUILT_IN).map((c) => c.name)).toEqual(['model']);
    expect(suggestCommands('/n', BUILT_IN).map((c) => c.name)).toEqual(['clear']);
    expect(suggestCommands('/model smart', BUILT_IN)).toEqual([]);
  });

  it("adds the page's commands, lets one replace a built-in by name, and removes one set to null", () => {
    const pin = { usage: '/pin', help: 'Pin it', run };
    const help = { usage: '/help', help: 'What this board can do', run };
    const commands = resolveCommands(BUILT_IN, { pin, help, model: null });

    expect(Object.keys(commands)).toEqual(['clear', 'help', 'pin']);
    expect(commands.help).toBe(help);
    expect(parseCommand('/model smart', commands)).toEqual({ unknown: 'model' });
  });

  it('lets a page build the whole set from the built-ins', () => {
    const commands = resolveCommands(BUILT_IN, (defaults) => ({ restart: { ...defaults.clear!, usage: '/restart' } }));
    expect(Object.keys(commands)).toEqual(['restart']);
    expect(parseCommand('/new', commands)).toMatchObject({ name: 'restart' });
  });

  it('skips a command whose name cannot be typed or that has nothing to run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const commands = resolveCommands({}, { 'pin it': { usage: '/pin it', help: '', run }, broken: { usage: '/broken', help: '' } as never });
    expect(commands).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('picks a model by its label or id, the default by name, and anything else as a model id', () => {
    expect(resolveModel('Smart', models)).toBe('z-ai/glm-5.3-flash');
    expect(resolveModel('default', models)).toBeUndefined();
    expect(resolveModel('z-ai/glm-5.3-prime', models)).toBe('z-ai/glm-5.3-prime');
  });
});
