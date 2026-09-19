import { defineCivitaiSignInButton } from './civitai-sign-in-button.js';

/** Register every element in this package. Safe to call more than once. */
export function registerAll(): void {
  defineCivitaiSignInButton();
}

registerAll();
