// POST /api/sync-briefs/<slug>
//
// On-demand single-slug sync. Same fetch + hash + parse + upsert path as
// the cron route, just scoped to one BriefRecord. Useful for:
//   • The producer wants to publish a Doc edit before the next 5-min tick.
//   • Manual debugging of a specific brief from the terminal.
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

  const result = await syncOne(rec);
  logSyncResult(result);
  return NextResponse.json({ ok: true, result });
}
