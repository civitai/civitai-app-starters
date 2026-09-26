import { getBuzzBalance, getMe } from '$lib/civitai';
import { scopesFromBitmask } from '@civitai/app-sdk/scopes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;
  if (!session) {
    return {
      session: null,
      error: url.searchParams.get('error'),
      notice: url.searchParams.get('notice'),
    };
  }

  let me: Awaited<ReturnType<typeof getMe>> | null = null;
  let meError: string | null = null;
  try {
    me = await getMe(session);
  } catch (err) {
    meError = err instanceof Error ? err.message : 'unknown';
  }

  // 🔴 SEPARATE CALL, SEPARATE FAILURE MODE. Buzz balance is NOT part of
  // `/api/v1/me`; it needs the `BuzzRead` scope on a different endpoint, and a
  // client that was not granted it gets a 403. `getBuzzBalance` turns that into
  // `null` and `+page.svelte` then renders no balance row at all — a missing
  // balance is not an error and must not take the profile card down with it.
  const buzzBalance = await getBuzzBalance(session);

  return {
    session: { scope: session.tokens.scope },
    me,
    meError,
    buzzBalance,
    grantedScopes: scopesFromBitmask(session.tokens.scope),
    error: url.searchParams.get('error'),
    notice: url.searchParams.get('notice'),
  };
};
