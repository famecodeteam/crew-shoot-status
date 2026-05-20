// POST /api/sync-briefs/<slug>
// POST /api/sync-briefs/<slug>?force=1
//
// On-demand single-slug sync. Same fetch + hash + parse + upsert path as
// the cron route, just scoped to one BriefRecord. Useful for:
//   • The producer wants to publish a Doc edit before the next 5-min tick.
//   • Manual debugging of a specific brief from the terminal.
//
// By default this respects syncOne's content-hash short-circuit — if the
// Doc hasn't changed since the last sync it returns "unchanged" without
// re-parsing. Pass ?force=1 (or ?force=true) to bypass that and force a
// full re-fetch + re-parse + upsert. Use force after a parser change, or
// when a brief looks stale and you want to be certain.
//
// Auth: same CRON_SECRET bearer as the cron route, so the same Vercel
// env var protects both. In dev (no CRON_SECRET set) the route is
// callable directly.

import { NextResponse, type NextRequest } from "next/server";
import { getBySlug } from "@/lib/brief-storage";
import { logSyncResult, syncOne } from "@/lib/sync-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { slug } = await ctx.params;
  const rec = await getBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "unknown brief" }, { status: 404 });
  }

  // ?force bypasses the content-hash short-circuit by clearing the
  // stored hash + parse before handing the record to syncOne — same
  // technique the bulk /api/backfill-briefs endpoint uses.
  const forceParam = req.nextUrl.searchParams.get("force");
  const force = forceParam === "1" || forceParam === "true";
  const toSync = force
    ? { ...rec, lastContentHash: null, parsedJson: null }
    : rec;

  const result = await syncOne(toSync);
  logSyncResult(result);
  return NextResponse.json({ ok: true, forced: force, result });
}
