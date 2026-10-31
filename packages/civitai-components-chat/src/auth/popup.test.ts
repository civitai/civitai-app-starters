import type { SignIn } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { popupSignIn } from './popup.js';

function pageSignIn(signedIn: boolean) {
  const auth = {
    signedIn,
    signInWithPopup: vi.fn(async () => {
      auth.signedIn = true;
    }),
    token: async () => 'token',
    refresh: async () => 'token',
    requestGrants: async () => true,
  };
  return auth;
}

describe('popupSignIn', () => {
  it("signs in through the page's own sign-in in a popup, then hands the chat a client for that viewer", async () => {
    const auth = pageSignIn(false);
    const abort = new AbortController();

    const app = await popupSignIn(auth as unknown as SignIn)({ signal: abort.signal });

    expect(auth.signInWithPopup).toHaveBeenCalledWith({ signal: abort.signal });
    await expect(app.getToken()).resolves.toBe('token');
  });

  it('skips the popup when the page is already signed in', async () => {
    const auth = pageSignIn(true);

    await popupSignIn(auth as unknown as SignIn)({ signal: new AbortController().signal });

    expect(auth.signInWithPopup).not.toHaveBeenCalled();
  });
});
