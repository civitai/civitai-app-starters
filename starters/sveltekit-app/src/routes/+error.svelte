<script lang="ts">
  import { page } from '$app/state';
</script>

<section class="flex flex-col gap-3">
  <h1 class="text-xl font-semibold text-red-700 dark:text-red-300">
    {page.status === 404 ? 'Page not found' : 'Something went wrong'}
  </h1>
  <p class="text-sm text-zinc-600 dark:text-zinc-400">
    {page.status === 404
      ? "The page you were looking for doesn't exist."
      : page.error?.message || 'The page hit an unexpected error.'}
  </p>
  <div class="flex gap-2">
    <a
      href="/"
      class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      Go home
    </a>
  </div>
</section>
