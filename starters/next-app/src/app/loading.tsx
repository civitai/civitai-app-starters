export default function Loading() {
  return (
    <section className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <div className="h-7 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-10 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
    </section>
  );
}
