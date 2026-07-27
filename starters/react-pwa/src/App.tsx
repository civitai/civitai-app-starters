import { useEffect, useState } from 'react';
import { getMe, type Me } from './lib/api';
import { LoginButton } from './components/LoginButton';
import { LogoutControls } from './components/LogoutControls';
import { GenerateForm } from './components/GenerateForm';
import { DesignSystemDemo } from './components/DesignSystemDemo';

function readQueryFlash(): { error?: string; notice?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    error: params.get('error') ?? undefined,
    notice: params.get('notice') ?? undefined,
  };
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash] = useState(readQueryFlash);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMe();
        if (!cancelled) setMe(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Civitai App Starter (React PWA)</h1>
        {me?.authenticated && <LogoutControls />}
      </header>

      <DesignSystemDemo />

      {flash.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          OAuth error: <code className="font-mono">{flash.error}</code>
        </div>
      )}
      {flash.notice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {flash.notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !me?.authenticated ? (
        <section className="flex flex-col gap-3">
          <p>
            Minimal Civitai PWA. Sign in with your Civitai account to check Buzz balance and
            generate one image — the tiny Hono BFF holds your OAuth tokens server-side; the
            browser only sees an opaque session cookie.
          </p>
          <LoginButton />
        </section>
      ) : (
        <>
          <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {me.error ? (
              <p className="text-sm text-red-600">
                Couldn't load profile: <code className="font-mono">{me.error}</code>
              </p>
            ) : (
              <>
                <p className="text-sm">
                  Signed in as <strong>{me.username ?? 'unknown'}</strong>
                </p>
                <p className="mt-1 text-sm">
                  Buzz balance: <strong>{me.balance ?? '—'}</strong>
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Granted scopes: <code className="font-mono">{me.grantedScopes?.join(', ')}</code>
                </p>
              </>
            )}
          </section>
          <GenerateForm initialBalance={me.balance} />
        </>
      )}

      <footer className="mt-auto text-xs text-zinc-500">
        Powered by{' '}
        <a
          href="https://github.com/civitai/civitai-app-starters"
          className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          civitai-app-starters
        </a>{' '}
        + <code className="font-mono">@civitai/app-sdk</code>.
      </footer>
    </main>
  );
}
