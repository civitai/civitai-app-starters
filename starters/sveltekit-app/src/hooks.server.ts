import { dev } from '$app/environment';
import { readSession } from '$lib/session';
import type { Handle } from '@sveltejs/kit';

/**
 * Populate `event.locals.session` for every request. `+page.server.ts` /
 * `+server.ts` handlers should read this instead of reaching for cookies.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.session = await readSession(event.cookies, !dev);
  return resolve(event);
};
