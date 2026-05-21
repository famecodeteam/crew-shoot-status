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
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
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
