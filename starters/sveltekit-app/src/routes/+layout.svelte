<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
  {@render children?.()}
</main>
