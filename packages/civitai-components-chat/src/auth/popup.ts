import { initialize, type AppClient, type SignIn } from '@civitai/sdk';

/**
 * A `signIn` for `<civitai-chat>` that signs in with the page's own `createSignIn()` in a popup, so
 * the page is never navigated away from. The page Civitai returns the popup to must call
 * `createSignIn()` for the same client, which completes it there.
 */
export function popupSignIn(auth: SignIn): (options: { signal: AbortSignal }) => Promise<AppClient> {
  return async ({ signal }) => {
    if (!auth.signedIn) await auth.signInWithPopup({ signal });
    return initialize(auth);
  };
}
