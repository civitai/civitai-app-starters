<script lang="ts">
  import DesignSystemDemo from '$lib/components/DesignSystemDemo.svelte';
  import GenerateForm from '$lib/components/GenerateForm.svelte';
  import LogoutControls from '$lib/components/LogoutControls.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<header class="flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Civitai App Starter (SvelteKit)</h1>
  {#if data.session}
    <LogoutControls />
  {/if}
</header>

<DesignSystemDemo />

{#if data.error}
  <div
    class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
  >
    OAuth error: <code class="font-mono">{data.error}</code>
  </div>
{/if}
{#if data.notice}
  <div
    class="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
  >
    {data.notice}
  </div>
{/if}

{#if !data.session}
  <section class="flex flex-col gap-3">
    <p>
      Minimal demo of a Civitai-powered app. Sign in with your Civitai account to check your
      Buzz balance and generate one image using your OAuth token.
    </p>
    <form method="post" action="/api/auth/login">
      <button
        type="submit"
        class="rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-500"
      >
        Sign in with Civitai
      </button>
    </form>
  </section>
{:else}
  <section
    class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
  >
    {#if data.meError}
      <p class="text-sm text-red-600">
        Couldn't load profile: <code class="font-mono">{data.meError}</code>
      </p>
    {:else}
      <p class="text-sm">
        Signed in as <strong>{data.me?.username ?? 'unknown'}</strong>
      </p>
      <p class="mt-1 text-sm">
        Buzz balance: <strong>{data.me?.balance ?? '—'}</strong>
      </p>
      <p class="mt-2 text-xs text-zinc-500">
        Granted scopes: <code class="font-mono">{data.grantedScopes?.join(', ')}</code>
      </p>
    {/if}
  </section>
  <GenerateForm initialBalance={data.me?.balance} />
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
