// .env is bridged into process.env by:
//   - dev:  vite.config.ts (loadEnv + Object.assign)
//   - prod: `node --env-file=.env dist-server/index.js` (Node ≥20.6 built-in)

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  CIVITAI_CLIENT_ID: required('CIVITAI_CLIENT_ID'),
  CIVITAI_CLIENT_SECRET: required('CIVITAI_CLIENT_SECRET'),
  SESSION_SECRET: required('SESSION_SECRET'),
  APP_URL: required('APP_URL'),
  CIVITAI_BASE_URL: optional('CIVITAI_BASE_URL', 'https://civitai.com'),
  ORCHESTRATOR_URL: optional('ORCHESTRATOR_URL', 'https://orchestration.civitai.com'),
  PORT: Number(optional('PORT', '5175')),
};

export const REDIRECT_URI = `${env.APP_URL}/api/auth/callback/civitai`;
