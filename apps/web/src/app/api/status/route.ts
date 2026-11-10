import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Tells the front page whether the realtime server answers. Runs on the server so the browser
 * does not need to know about CORS for a simple "is anyone home" check.
 */
export async function GET() {
  const base = (process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:4001').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    const h = (await res.json()) as { players?: number; rooms?: number; voice?: boolean };
    return NextResponse.json({ online: true, players: h.players ?? 0, voice: !!h.voice });
  } catch {
    return NextResponse.json({ online: false, players: 0, voice: false });
  }
}
