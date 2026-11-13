/**
 * Type-level: an unknown lookup cannot be read as "no sampler". `sampler` exists
 * only on the `known: true` arm, so code has to narrow before it can treat the
 * answer as `null`. Compiled by `tsc -p tsconfig.typecheck.json`.
 */
import { resolveGenerationSampler } from '../../src/blocks/index.js';
import type { GenerationSamplerCatalog, GenerationSamplerField } from '../../src/blocks/index.js';

declare const catalog: GenerationSamplerCatalog;
const lookup = resolveGenerationSampler(catalog, { baseModel: 'SDXL 1.0', modelVersionId: 1 });

// @ts-expect-error — `sampler` is not readable before narrowing on `known`.
void lookup.sampler;

if (lookup.known) {
  const field: GenerationSamplerField | null = lookup.sampler;
  void field;
} else {
  // @ts-expect-error — an unknown result carries no `sampler`.
  void lookup.sampler;
  const reason: 'base-model-not-in-catalog' | 'family-not-in-catalog' | 'base-model-required' = lookup.reason;
  void reason;
}
