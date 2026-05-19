import { useState } from 'react';
import { logout, revoke } from '../lib/api';

export function LogoutControls() {
  const [busy, setBusy] = useState<'none' | 'logout' | 'revoke'>('none');

  async function call(kind: 'logout' | 'revoke') {
    setBusy(kind);
    try {
      if (kind === 'logout') await logout();
      else await revoke();
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
        onClick={() => call('logout')}
        className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {busy === 'logout' ? 'Signing out…' : 'Sign out (local)'}
      </button>
      <button
        type="button"
        disabled={busy !== 'none'}
        onClick={() => call('revoke')}
        className="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >
        {busy === 'revoke' ? 'Revoking…' : 'Revoke at Civitai'}
      </button>
    </div>
  );
}
