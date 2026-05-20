'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * App-level error boundary. Rendered when a route handler or React component
 * throws. `reset()` re-runs the segment without a full reload — good for
 * transient failures (network blip, expired OAuth code, etc).
 *
 * Next docs: https://nextjs.org/docs/app/getting-started/error-handling
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with your reporting (Sentry, PostHog, etc).
    console.error(error);
  }, [error]);

  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold text-red-700 dark:text-red-300">
        Something went wrong
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The page hit an unexpected error. You can retry — most often this is
        a transient network or OAuth-token issue.
      </p>
      {error.digest && (
        <p className="text-xs text-zinc-500">
          Error ID: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Go home
        </Link>
      </div>
    </section>
  );
}
