<script lang="ts">
  import { onMount } from 'svelte';
  import GenerateForm from './components/GenerateForm.svelte';
  import LoginButton from './components/LoginButton.svelte';
  import LogoutControls from './components/LogoutControls.svelte';
  import { getMe, type Me } from './lib/api';

  let me = $state<Me | null>(null);
  let loading = $state(true);

  const flash = (() => {
    const params = new URLSearchParams(window.location.search);
    return {
      error: params.get('error') ?? undefined,
      notice: params.get('notice') ?? undefined,
    };
  })();

  onMount(async () => {
    try {
      me = await getMe();
    } finally {
      loading = false;
    }
  });
</script>

<svelte:boundary onerror={(err) => console.error('Boundary caught:', err)}>
  {#snippet failed(error, reset)}
    <main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 px-6 py-12">
      <h1 class="text-xl font-semibold text-red-700 dark:text-red-300">
        Something went wrong
      </h1>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">
        {error instanceof Error ? error.message : 'The app hit an unexpected error.'}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          onclick={reset}
          class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Try again
        </button>
        <button
          type="button"
          onclick={() => window.location.reload()}
          class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Reload
        </button>
      </div>
    </main>
  {/snippet}

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
  <header class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Civitai App Starter (Svelte PWA)</h1>
    {#if me?.authenticated}
      <LogoutControls />
    {/if}
  </header>

  {#if flash.error}
    <div
      class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      OAuth error: <code class="font-mono">{flash.error}</code>
    </div>
  {/if}
  {#if flash.notice}
    <div
      class="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    >
      {flash.notice}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-zinc-500">Loading…</p>
  {:else if !me?.authenticated}
    <section class="flex flex-col gap-3">
      <p>
        Minimal Civitai PWA. Sign in with your Civitai account to check your Buzz balance and
        generate one image — the tiny Hono BFF holds your OAuth tokens server-side; the browser
        only sees an opaque session cookie.
      </p>
      <LoginButton />
    </section>
  {:else}
    <section
      class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {#if me.error}
        <p class="text-sm text-red-600">
          Couldn't load profile: <code class="font-mono">{me.error}</code>
        </p>
      {:else}
        <p class="text-sm">
          Signed in as <strong>{me.username ?? 'unknown'}</strong>
        </p>
        <p class="mt-1 text-sm">
          Buzz balance: <strong>{me.balance ?? '—'}</strong>
        </p>
        <p class="mt-2 text-xs text-zinc-500">
          Granted scopes: <code class="font-mono">{me.grantedScopes?.join(', ')}</code>
        </p>
      {/if}
    </section>
    <GenerateForm initialBalance={me.balance} />
  {/if}

  <footer class="mt-auto text-xs text-zinc-500">
    Powered by
    <a
      href="https://github.com/civitai/civitai-app-starters"
      class="underline hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      civitai-app-starters
    </a>
    + <code class="font-mono">@civitai/app-sdk</code>.
  </footer>
</main>
</svelte:boundary>
