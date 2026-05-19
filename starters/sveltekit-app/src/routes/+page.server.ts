import { getMe } from '$lib/civitai';
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

  return {
    session: { scope: session.tokens.scope },
    me,
    meError,
    grantedScopes: scopesFromBitmask(session.tokens.scope),
    error: url.searchParams.get('error'),
    notice: url.searchParams.get('notice'),
  };
};
