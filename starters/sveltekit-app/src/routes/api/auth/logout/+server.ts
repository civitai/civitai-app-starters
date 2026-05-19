import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { clearSession } from '$lib/session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  clearSession(cookies, !dev);
  return json({ ok: true });
};
