import { NextResponse } from 'next/server';

const STARTED_AT = Date.now();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness probe. Returns 200 once the process is up; never touches a DB or
 * the orchestrator. Container platforms (Fly, Cloud Run, Render, Kubernetes)
 * poll this to decide when to route traffic.
 */
export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      startedAt: new Date(STARTED_AT).toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
