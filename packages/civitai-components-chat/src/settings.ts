import { chatConfig } from './config.js';
import type { Settings, Theme } from './types.js';

/** Each embedding app's scope keeps its own preferences, above all which chat was open last. */
export const settingsKey = (scope?: string): string => (scope ? `cvt:settings:${scope}` : 'cvt:settings');

export const defaultSettings = (): Settings => ({
  theme: 'system',
  allowMature: false,
  autoRunLimit: chatConfig.autoRunLimit,
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function local(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(key = settingsKey(), storage: StorageLike | undefined = local()): Settings {
  try {
    const raw = storage?.getItem(key);
    return raw ? { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings, key = settingsKey(), storage: StorageLike | undefined = local()): void {
  try {
    storage?.setItem(key, JSON.stringify(settings));
  } catch {
    // Preferences are per device and optional.
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
