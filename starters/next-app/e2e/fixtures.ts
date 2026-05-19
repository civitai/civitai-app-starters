/**
 * Re-export Playwright's `test` + `expect`. All e2e specs run with the
 * storage state from `global-setup.ts` (Civitai session cookies already
 * injected by Playwright on context creation). See `playwright.config.ts`
 * for the wiring.
 */
export { test, expect } from '@playwright/test';
