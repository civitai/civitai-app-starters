import { initialize } from '@civitai/sdk';

const [versionId = '128078', prompt = 'A lighthouse at dusk, oil painting'] = process.argv.slice(2);

const app = await initialize({
  token: process.env.CIVITAI_TOKEN ?? '',
  siteUrl: process.env.CIVITAI_SITE_URL,
  orchestrationUrl: process.env.ORCHESTRATION_URL,
});

const version = await app.site.get<{ air: string; modelName: string; versionName: string }>(
  `model-versions/mini/${versionId}`,
);
console.log(`model  ${version.modelName} · ${version.versionName}`);

const submitted = await app.orchestration.submitWorkflow({
  steps: [
    {
      $type: 'textToImage',
      input: {
        model: version.air,
        prompt,
        width: 1024,
        height: 1024,
        cfgScale: 7,
        seed: Math.floor(Math.random() * 2 ** 31),
      },
    },
  ],
});
console.log(`submitted ${submitted.id}`);

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());

try {
  for await (const workflow of app.orchestration.watchWorkflow(submitted.id!, { signal: stop.signal })) {
    // Outputs are listed before they exist; `available` says when one can be shown.
    const images = workflow.steps
      .flatMap((step) => (step.$type === 'textToImage' ? (step.output?.images ?? []) : []))
      .filter((image) => image.available);
    console.log(`${workflow.status.padEnd(10)} ${images.map((image) => image.url).join(' ')}`);
  }
} catch (error) {
  if (!stop.signal.aborted) throw error;
  await app.orchestration.cancelWorkflow(submitted.id!);
  console.log('canceled');
}

