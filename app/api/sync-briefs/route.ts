// Vercel Cron: GET /api/sync-briefs (every 5 minutes per vercel.json).
//
// For each registered brief, call lib/sync-brief.syncOne — fetch the
// Doc, hash-skip if unchanged, otherwise re-parse and upsert. Per-brief
// failures are captured on the record without overwriting the last good
// parse. The whole loop is time-boxed at 55s so we exit cleanly before
// Vercel's 60s cron cap; oldest-first ordering means stragglers land on
// the next tick.
//
// Auth: when CRON_SECRET is set in env, Vercel includes Authorization:
// Bearer <secret> on every cron-triggered request. In dev (no secret
// set) the route is callable directly — handy for manual triggers.

import { NextResponse, type NextRequest } from "next/server";
import { listAll } from "@/lib/brief-storage";
import { logSyncResult, syncOne, type SyncResult } from "@/lib/sync-brief";

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

  const deadline = Date.now() + TIME_BUDGET_MS;
  const briefs = await listAll();

  // Oldest-first so stragglers in long batches still get caught next tick.
  // null lastSyncedAt sorts first (brand-new briefs).
  briefs.sort((a, b) => {
    const av = a.lastSyncedAt ?? "";
    const bv = b.lastSyncedAt ?? "";
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  const results: SyncResult[] = [];
  for (const b of briefs) {
    if (Date.now() > deadline) {
      results.push({ slug: b.slug, status: "skipped_timeout", durationMs: 0 });
      continue;
    }
    const r = await syncOne(b);
    logSyncResult(r);
    results.push(r);
  }

  return NextResponse.json({ ok: true, total: briefs.length, results });
}
