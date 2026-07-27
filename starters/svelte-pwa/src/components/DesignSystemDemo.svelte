<script lang="ts">
  // Small showcase of the Civitai design system as framework-agnostic markup:
  // bare HTML with `data-civitai-ui` attributes (the contract in
  // @civitai/components/MARKUP.md), themed by the `--civitai-*` tokens from
  // @civitai/theme. No React needed — the same components the React starters
  // render, driven purely by attributes + CSS.
  let prompt = $state('a corgi astronaut');
</script>

<div data-civitai-ui="card" data-with-border="true" data-padding="lg" data-testid="ds-card">
  <div class="flex flex-col gap-3">
    <div>
      <h2 class="text-lg font-semibold">Civitai design system</h2>
      <p class="text-sm" style="color: var(--civitai-color-text-dimmed)">
        Bare <code class="font-mono">data-civitai-ui</code> markup from
        <code class="font-mono">@civitai/components</code>, themed by
        <code class="font-mono">--civitai-*</code> tokens.
      </p>
    </div>

    <div data-civitai-ui="text-input">
      <label data-civitai-ui-label for="ds-prompt">Prompt</label>
      <span id="ds-prompt-desc" data-civitai-ui-description>
        A themed text input from the design system.
      </span>
      <input
        data-civitai-ui-control
        id="ds-prompt"
        aria-describedby="ds-prompt-desc"
        bind:value={prompt}
      />
    </div>

    <button
      data-civitai-ui="button"
      data-variant="filled"
      data-size="md"
      data-testid="ds-button"
      type="button"
    >
      Generate
    </button>
  </div>
</div>
