// GET /api/sync-status - when did the shoot sync last run, and how did it go?
//
// Exists because a client status page going stale has been diagnosed by guess
// three times. Vercel runtime logs aren't reachable from the CLI or API here,
// so this is the only way to answer "is the 5-minute cron actually running".
//
// Auth: same secrets as /api/sync-shoots. The delivery portal proxies it
// behind an admin session, so Tom never needs the secret.

import { NextResponse, type NextRequest } from "next/server";

type SyncHeartbeatLike = { at: string };
import {
  readSyncHeartbeat,
  readSyncHeartbeatsByTrigger,
} from "@/lib/sync-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const accepts = [
    process.env.CRON_SECRET,
    process.env.ADMIN_RESYNC_TOKEN,
    process.env.SYNC_API_SECRET,
  ].filter(Boolean) as string[];
  if (accepts.length > 0) {
    const auth = req.headers.get("authorization") ?? "";
    const token = req.nextUrl.searchParams.get("token") ?? "";
    if (!accepts.some((s) => auth === `Bearer ${s}` || token === s)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const [beat, byTrigger] = await Promise.all([
    readSyncHeartbeat(),
    readSyncHeartbeatsByTrigger(),
  ]);
  if (!beat) {
    return NextResponse.json({
      lastRun: null,
      note: "no sync has completed since the heartbeat shipped",
    });
  }
  const ageMs = Date.now() - Date.parse(beat.at);
  const ageOf = (b: SyncHeartbeatLike | null) =>
    b ? Math.round((Date.now() - Date.parse(b.at)) / 1000) : null;

  return NextResponse.json({
    lastRun: beat,
    ageSeconds: Math.round(ageMs / 1000),
    // Per-trigger, because the cron overwrites the single slot every 5 min and
    // hides whether pushes are landing at all.
    lastPush: byTrigger.push ?? null,
    lastPushAgeSeconds: ageOf(byTrigger.push ?? null),
    lastCron: byTrigger.cron ?? null,
    lastManual: byTrigger.manual ?? null,
    // The cron is every 5 minutes, so anything past ~11 means it missed at
    // least two runs - the state that leaves a client looking at a stale page.
    cronLooksHealthy: beat.trigger === "cron" ? ageMs < 11 * 60_000 : null,
  });
}
