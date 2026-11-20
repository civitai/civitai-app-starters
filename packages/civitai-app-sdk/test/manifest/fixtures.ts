import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

import { loadCanonicalSchema } from '../../src/manifest/defineBlock.js';
import type { BlockManifest } from '../../src/blocks/types.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const STARTERS_DIR = join(REPO_ROOT, 'starters');

/**
 * An INDEPENDENT Ajv compile of the same vendored schema. `defineBlock` runs
 * Ajv internally, so this cannot prove the ⊆ direction (reject everything the
 * schema rejects) — that holds by construction. What it IS for is the ⊇
 * direction: showing that a fixture the CANONICAL accepts is accepted by
 * `defineBlock` too, unless a SCHEMA_DIVERGENCES entry says otherwise. A
 * hand-written rule sneaking back above the canonical shows up exactly there.
 */
let cached: ValidateFunction | undefined;
export function canonicalAccepts(manifest: unknown): true | string {
  if (!cached) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    cached = ajv.compile(loadCanonicalSchema());
  }
  if (cached(manifest)) return true;
  return JSON.stringify(cached.errors);
}

/**
 * The base fixture. Deliberately CANONICAL-VALID and deliberately shaped like
 * what the starters ship (no `iframe.src`, `appId` present) — #330's first red
 * run was VACUOUS because its base fixture omitted `iframe.src` and every case
 * died on that before reaching the rule under test.
 *
 * Values are chosen distinct from every constant the assertions name (137-char
 * name, 613 px, 4137) so a mutant that hardcodes a literal cannot survive.
 */
export function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'https://civitai.com/schemas/app-block/v1.json',
    blockId: 'fixture-block',
    version: '0.3.7',
    name: 'Fixture Block',
    type: 'block',
    targets: [{ slotId: 'model.sidebar_top', priority: 137 }],
    scopes: ['models:read:self'],
    iframe: { minHeight: 137, maxHeight: 613, resizable: true, sandbox: 'allow-scripts allow-forms' },
    contentRating: 'pg',
    minApiVersion: '1.0',
    ...overrides,
  };
}

/** `valid()` minus the named keys, plus any overrides. */
export function without(
  keys: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const manifest = valid(overrides);
  for (const key of keys) delete manifest[key];
  return manifest;
}

export interface ShippedManifest {
  /** Repo-relative directory, e.g. `starters/examples/hello-world`. */
  label: string;
  dir: string;
  manifest: BlockManifest;
}

function findByName(dir: string, name: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findByName(full, name, out);
    else if (entry.name === name) out.push(full);
  }
  return out;
}

export function manifestFiles(): string[] {
  return findByName(STARTERS_DIR, 'block.manifest.json').sort();
}

export function shippedManifests(): ShippedManifest[] {
  return manifestFiles().map((file) => ({
    label: file.slice(REPO_ROOT.length + 1),
    dir: dirname(file),
    manifest: JSON.parse(readFileSync(file, 'utf8')) as BlockManifest,
  }));
}
