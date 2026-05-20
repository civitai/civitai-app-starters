#!/usr/bin/env node
/**
 * Standalone env validator. Loads .env, validates required vars with zod, and
 * exits non-zero with a readable list of what's missing or malformed. Run via
 * `pnpm check:env` — useful as a first sanity check before `pnpm dev` so you
 * don't get an opaque 401 mid-OAuth callback.
 *
 * Mirrors the schema in `src/lib/env.ts`. Keep them in sync.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';

function loadDotenv(filepath) {
  if (!existsSync(filepath)) return false;
  for (const line of readFileSync(filepath, 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

const cwd = process.cwd();
const envPath = path.resolve(cwd, '.env');
const loaded = loadDotenv(envPath);
if (!loaded) {
  console.error(`✗ No .env at ${envPath}. Copy .env.example to .env and fill in values.`);
  process.exit(1);
}

const schema = z.object({
  CIVITAI_CLIENT_ID: z.string().min(1, 'register an OAuth App at civitai.com/user/account'),
  CIVITAI_CLIENT_SECRET: z.string().min(1, 'paste the Client Secret from the OAuth App'),
  SESSION_SECRET: z
    .string()
    .min(32, 'must be ≥32 chars. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'),
  NEXT_PUBLIC_APP_URL: z.string().url('must be a full URL (e.g. http://localhost:3000)'),
  CIVITAI_BASE_URL: z.string().url().optional(),
  ORCHESTRATOR_URL: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(`✗ Env validation failed (loaded from ${envPath}):`);
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`✓ Env OK (loaded from ${envPath})`);
for (const [k, v] of Object.entries(parsed.data)) {
  if (v === undefined) continue;
  console.log(`  ${k}: ${k.endsWith('SECRET') ? '<redacted>' : v}`);
}
