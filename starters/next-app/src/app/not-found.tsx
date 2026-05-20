import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The page you were looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Go home
      </Link>
    </section>
  );
}
