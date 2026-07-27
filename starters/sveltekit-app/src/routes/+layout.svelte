<script lang="ts">
  import '../app.css';
  // Civitai design system — tokens + component CSS (bare-markup consumption).
  // Loaded in the root layout so styles are present in the SSR HTML on first
  // paint; order-locked by the @layer declaration at the top of app.css.
  import '@civitai/theme/styles.css';
  import '@civitai/components/styles.css';

  let { children } = $props();
</script>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
  {@render children?.()}
</main>
