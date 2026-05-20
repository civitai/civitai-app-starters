import { getMe } from '@/lib/civitai';
import { getSession } from '@/lib/session';
import { scopesFromBitmask } from '@civitai/app-sdk/scopes';
import { GenerateForm } from '@/components/GenerateForm';
import { LoginButton } from '@/components/LoginButton';
import { LogoutControls } from '@/components/LogoutControls';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Civitai App Starter</h1>
        {session && <LogoutControls />}
      </header>

      {params.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          OAuth error: <code className="font-mono">{params.error}</code>
        </div>
      )}
      {params.notice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {params.notice}
        </div>
      )}

      {!session ? (
        <LoggedOut />
      ) : (
        <LoggedIn
          accessToken={session.tokens.access_token}
          scope={session.tokens.scope}
        />
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
    </>
  );
}

function LoggedOut() {
  return (
    <section className="flex flex-col gap-3">
      <p>
        This is a minimal demo of a Civitai-powered app. Sign in with your Civitai account to
        check your Buzz balance and generate one image — all using your Civitai OAuth token.
      </p>
      <LoginButton />
    </section>
  );
}

async function LoggedIn({ accessToken, scope }: { accessToken: string; scope: number }) {
  // Fetch /me lazily — keeps the page snappy on the first render and surfaces auth issues early.
  let me: Awaited<ReturnType<typeof getMe>> | null = null;
  let meError: string | null = null;
  try {
    me = await getMe({ tokens: { access_token: accessToken, expires_at: Date.now() + 60_000, scope } });
  } catch (err) {
    meError = err instanceof Error ? err.message : 'unknown';
  }

  const grantedScopes = scopesFromBitmask(scope);

  return (
    <>
      <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {meError ? (
          <p className="text-sm text-red-600">
            Couldn&apos;t load profile: <code className="font-mono">{meError}</code>
          </p>
        ) : (
          <>
            <p className="text-sm">
              Signed in as <strong>{me?.username ?? 'unknown'}</strong>
            </p>
            <p className="mt-1 text-sm">
              Buzz balance: <strong>{me?.balance ?? '—'}</strong>
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Granted scopes: <code className="font-mono">{grantedScopes.join(', ')}</code>
            </p>
          </>
        )}
      </section>
      <GenerateForm initialBalance={me?.balance} />
    </>
  );
}
