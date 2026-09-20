#!/usr/bin/env node
/**
 * API-surface snapshot, derived from custom-elements.json.
 *
 * WHY. The audit of the two React packages found 59% of their public surface
 * undocumented and ungated: props were added, renamed and dropped (`color`
 * exists on one Button and not the other; `Stack.gap` means two different
 * things) with nothing in CI that could see it. A new package is the cheap
 * moment to start, because the snapshot is empty-to-correct rather than
 * 34-components-of-catching-up.
 *
 * WHAT IT PINS. Per tag: every attribute (name + type + default), every
 * writable property, every event (name + detail type), every CSS custom
 * property, and whether the element is form-associated. Deliberately NOT the
 * descriptions — prose churn must not fail CI, or the gate becomes the
 * permanently-red kind everyone clicks through.
 *
 *   node scripts/api-snapshot.mjs --write   # accept the current surface
 *   node scripts/api-snapshot.mjs --check   # CI: fail on any drift
 *
 * A --check failure is not "you did something wrong": it is "this changes the
 * public surface — confirm it is intended, then --write and commit the diff in
 * the same PR", which puts the change in review where a human sees it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const manifestPath = join(pkgRoot, 'custom-elements.json');
const snapshotPath = join(pkgRoot, 'api-snapshot.json');

export function buildSnapshot(manifest) {
  const tags = {};
  for (const mod of manifest.modules ?? []) {
    for (const d of mod.declarations ?? []) {
      if (!d.customElement || !d.tagName) continue;
      const members = (d.members ?? []).filter(
        (m) =>
          m.kind === 'field' &&
          !m.static &&
          (!m.privacy || m.privacy === 'public') &&
          !m.name.startsWith('#') &&
          !m.name.startsWith('_')
      );
      tags[d.tagName] = {
        className: d.name,
        formAssociated: (d.members ?? []).some((m) => m.static && m.name === 'formAssociated'),
        attributes: (d.attributes ?? [])
          .map((a) => ({
            name: a.name,
            type: norm(a.type?.text),
            default: a.default ?? null,
            fieldName: a.fieldName ?? null,
          }))
          .sort(byName),
        properties: members
          .map((m) => ({
            name: m.name,
            type: norm(m.type?.text),
            readonly: m.readonly === true,
            default: m.default ?? null,
          }))
          .sort(byName),
        events: (d.events ?? [])
          .filter((e) => e.description)
          .map((e) => ({ name: e.name, type: norm(e.type?.text) }))
          .sort(byName),
        cssProperties: (d.cssProperties ?? []).map((c) => ({ name: c.name })).sort(byName),
      };
    }
  }
  return { schemaVersion: 1, tags };
}

function norm(t) {
  return t ? String(t).replace(/\s+/g, ' ').trim() : null;
}
function byName(a, b) {
  return a.name.localeCompare(b.name);
}

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--write')
    ? 'write'
    : null;

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!mode) {
    console.error('usage: api-snapshot.mjs --write | --check');
    process.exit(2);
  }
  if (!existsSync(manifestPath)) {
    console.error(
      `no custom-elements.json — run \`pnpm --filter @civitai/elements analyze\` first.`
    );
    process.exit(2);
  }
  const current = buildSnapshot(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const tagCount = Object.keys(current.tags).length;
  if (tagCount === 0) {
    // A snapshot of nothing would "match" any future empty manifest and gate
    // nothing at all.
    console.error('refusing: the manifest declares no tagged elements.');
    process.exit(2);
  }
  const text = `${JSON.stringify(current, null, 2)}\n`;

  if (mode === 'write') {
    writeFileSync(snapshotPath, text);
    console.log(`[api-snapshot] wrote api-snapshot.json for ${tagCount} elements`);
    process.exit(0);
  }

  if (!existsSync(snapshotPath)) {
    console.error('no api-snapshot.json — run `pnpm --filter @civitai/elements api:snapshot`.');
    process.exit(1);
  }
  const previous = readFileSync(snapshotPath, 'utf8');
  if (previous === text) {
    console.log(`[api-snapshot] public surface unchanged (${tagCount} elements).`);
    process.exit(0);
  }
  console.error('[api-snapshot] PUBLIC SURFACE CHANGED.\n');
  console.error(diff(JSON.parse(previous), current));
  console.error(
    '\nIf this is intended, run `pnpm --filter @civitai/elements api:snapshot` and commit api-snapshot.json in the SAME pr.'
  );
  process.exit(1);
}

/** A readable, line-oriented diff of the two surfaces. */
function diff(a, b) {
  const out = [];
  const tags = new Set([...Object.keys(a.tags ?? {}), ...Object.keys(b.tags ?? {})]);
  for (const tag of [...tags].sort()) {
    const from = a.tags?.[tag];
    const to = b.tags?.[tag];
    if (!from) {
      out.push(`+ ${tag} (new element)`);
      continue;
    }
    if (!to) {
      out.push(`- ${tag} (REMOVED)`);
      continue;
    }
    for (const group of ['attributes', 'properties', 'events', 'cssProperties']) {
      const fa = new Map((from[group] ?? []).map((x) => [x.name, JSON.stringify(x)]));
      const ta = new Map((to[group] ?? []).map((x) => [x.name, JSON.stringify(x)]));
      for (const [name, json] of ta) {
        if (!fa.has(name)) out.push(`+ ${tag} ${group}.${name}  ${json}`);
        else if (fa.get(name) !== json)
          out.push(`~ ${tag} ${group}.${name}\n    was ${fa.get(name)}\n    now ${json}`);
      }
      for (const name of fa.keys()) if (!ta.has(name)) out.push(`- ${tag} ${group}.${name}`);
    }
    if (from.formAssociated !== to.formAssociated)
      out.push(`~ ${tag} formAssociated: ${from.formAssociated} -> ${to.formAssociated}`);
  }
  return out.join('\n');
}
