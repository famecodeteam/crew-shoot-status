// Vercel Cron: GET /api/sync-shoots (every 5 minutes per vercel.json).
//
// Pulls shoot data from the crew portal's /api/sync/shoots feed into our
// shoot store - the new source of truth for the status page (replacing the
// direct Trello read). The Trello webhook stays active as a fallback for
// now, so this and the webhook both write the store; they agree because
// the feed mirrors Trello.
//
// Auth: mirrors /api/sync-stream - CRON_SECRET (what Vercel cron sends) or
// ADMIN_RESYNC_TOKEN (manual trigger), via Bearer header or ?token=.

import { NextResponse, type NextRequest } from "next/server";
import { syncFromFeed } from "@/lib/sync-from-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Runtime scales with shoot count - ~235ms each, so 124 shoots takes ~29s.
// At the old 60s cap this would have started timing out around 255 shoots,
// and a timeout here is silent: every client status page simply stops
// updating until someone presses "Sync to client page" by hand. It has
// already happened once at 61.2s. 300s buys roughly 1,200 shoots of headroom.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Accept CRON_SECRET (Vercel cron), ADMIN_RESYNC_TOKEN (manual), or the
  // shared SYNC_API_SECRET (so the portal side can trigger a verify run).
  const accepts = [
    process.env.CRON_SECRET,
    process.env.ADMIN_RESYNC_TOKEN,
    process.env.SYNC_API_SECRET,
  ].filter(Boolean) as string[];
  if (accepts.length > 0) {
    const auth = req.headers.get("authorization") ?? "";
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const ok = accepts.some((s) => auth === `Bearer ${s}` || token === s);
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  // Vercel's cron sends CRON_SECRET; a person pressing "Sync to client page"
  // comes in on one of the others. Recording which lets a stale page be traced
  // to "the cron stopped" instead of guessed at.
  const auth = req.headers.get("authorization") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const trigger =
    cronSecret && (auth === `Bearer ${cronSecret}` || token === cronSecret)
      ? ("cron" as const)
      : ("manual" as const);
  const summary = await syncFromFeed({ dryRun, trigger });
  console.log(`[sync-shoots] ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
