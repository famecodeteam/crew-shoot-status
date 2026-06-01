// Vercel Cron: GET /api/sync-stream (every 5 minutes per vercel.json).
//
// Walks every asset version and keeps its Cloudflare Stream copy in step
// (see lib/sync-stream): un-ingested versions get a copyFromUrl kicked
// off, "pending" ones get polled to ready/error. Non-blocking - the
// transcode finishes across ticks. Time-boxed at 55s to exit before
// Vercel's 60s cron cap.
//
// Auth: when CRON_SECRET is set, Vercel includes Authorization: Bearer
// <secret> on every cron-triggered request. In dev (no secret) the route
// is callable directly - handy for manual triggers.

import { NextResponse, type NextRequest } from "next/server";
import { syncStreamOnce } from "@/lib/sync-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 55_000;

export async function GET(req: NextRequest) {
  // CRON_SECRET is what Vercel cron sends. ADMIN_RESYNC_TOKEN is the
  // operator escape hatch for manual triggers (e.g. forcing a re-ingest
  // pass right after clearing a Cloudflare Stream limit) without waiting
  // for the 5-min cron - CRON_SECRET is sensitive and can't be pulled to
  // a laptop. Same pattern as /api/admin/resync-card + /api/admin/health.
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_RESYNC_TOKEN;
  if (cronSecret || adminToken) {
    const auth = req.headers.get("authorization") ?? "";
    const ok =
      (cronSecret && auth === `Bearer ${cronSecret}`) ||
      (adminToken && auth === `Bearer ${adminToken}`);
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary = await syncStreamOnce(Date.now() + TIME_BUDGET_MS);

  // One structured log line per version touched - filterable in Vercel logs.
  for (const r of summary.results) {
    console.log(`[sync-stream] ${JSON.stringify(r)}`);
  }

  return NextResponse.json({ ok: true, ...summary });
}
