<script lang="ts">
  let busy = $state<'none' | 'logout' | 'revoke'>('none');

  async function call(path: '/api/auth/logout' | '/api/auth/revoke') {
    busy = path === '/api/auth/logout' ? 'logout' : 'revoke';
    try {
      await fetch(path, { method: 'POST' });
      window.location.href = '/';
    } finally {
      busy = 'none';
    }
  }
</script>

<div class="flex gap-2 text-sm">
  <button
    type="button"
    disabled={busy !== 'none'}
    onclick={() => call('/api/auth/logout')}
    class="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
  >
    {busy === 'logout' ? 'Signing out…' : 'Sign out (local)'}
  </button>
  <button
    type="button"
    disabled={busy !== 'none'}
    onclick={() => call('/api/auth/revoke')}
    class="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
  >
    {busy === 'revoke' ? 'Revoking…' : 'Revoke at Civitai'}
  </button>
</div>
