'use client';

import { useState } from 'react';

export function LogoutControls() {
  const [busy, setBusy] = useState<'none' | 'logout' | 'revoke'>('none');

  async function call(path: '/api/auth/logout' | '/api/auth/revoke') {
    setBusy(path === '/api/auth/logout' ? 'logout' : 'revoke');
    try {
      await fetch(path, { method: 'POST' });
      window.location.href = '/';
    } finally {
      setBusy('none');
    }
  }

  return (
    <div className="flex gap-2 text-sm">
      <button
        type="button"
        disabled={busy !== 'none'}
        onClick={() => call('/api/auth/logout')}
        className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {busy === 'logout' ? 'Signing out…' : 'Sign out (local)'}
      </button>
      <button
        type="button"
        disabled={busy !== 'none'}
        onClick={() => call('/api/auth/revoke')}
        className="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >
        {busy === 'revoke' ? 'Revoking…' : 'Revoke at Civitai'}
      </button>
    </div>
  );
}
