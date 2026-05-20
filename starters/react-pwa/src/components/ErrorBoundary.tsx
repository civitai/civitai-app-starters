import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root-level error boundary. Catches any render-time throw in the React tree
 * and offers a Reload. The OAuth callback is a redirect, not a render, so
 * its failures arrive as `?error=…` query params handled in App.tsx — but
 * any subsequent fetch/parse error will land here.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Replace with your reporting (Sentry, PostHog, etc).
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 px-6 py-12">
        <h1 className="text-xl font-semibold text-red-700 dark:text-red-300">
          Something went wrong
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {this.state.error.message || 'The app hit an unexpected error.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Reload
        </button>
      </main>
    );
  }
}
