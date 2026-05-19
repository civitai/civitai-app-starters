import { env } from '$env/dynamic/private';

function required(name: keyof typeof env): string {
  const v = env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: keyof typeof env, fallback: string): string {
  return env[name] ?? fallback;
}

export const config = {
  CIVITAI_CLIENT_ID: required('CIVITAI_CLIENT_ID'),
  CIVITAI_CLIENT_SECRET: required('CIVITAI_CLIENT_SECRET'),
  SESSION_SECRET: required('SESSION_SECRET'),
  APP_URL: required('APP_URL'),
  CIVITAI_BASE_URL: optional('CIVITAI_BASE_URL', 'https://civitai.com'),
  ORCHESTRATOR_URL: optional('ORCHESTRATOR_URL', 'https://orchestration.civitai.com'),
};

export const REDIRECT_URI = `${config.APP_URL}/api/auth/callback/civitai`;
