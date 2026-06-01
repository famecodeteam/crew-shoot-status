// GET /api/admin/stream-usage
//
// Reports the shared Cloudflare Stream account's storage usage (stored
// minutes vs. limit). Stream bills by duration, not bytes, so this is the
// quota the "10011 Storage capacity exceeded" ingest error is measured
// against. Quick read-only diagnostic for "are we over, and by how much".
//
// Auth: CRON_SECRET or ADMIN_RESYNC_TOKEN bearer.

import { NextResponse, type NextRequest } from "next/server";
import { getStorageUsage } from "@/lib/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_RESYNC_TOKEN;
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (adminToken && auth === `Bearer ${adminToken}`);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const usage = await getStorageUsage();
    const overBy = Math.max(
      0,
      usage.totalStorageMinutes - usage.totalStorageMinutesLimit,
    );
    const remaining = Math.max(
      0,
      usage.totalStorageMinutesLimit - usage.totalStorageMinutes,
    );
    return NextResponse.json({
      ok: true,
      ...usage,
      overQuota: usage.totalStorageMinutes > usage.totalStorageMinutesLimit,
      overByMinutes: Math.round(overBy),
      remainingMinutes: Math.round(remaining),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 },
    );
  }
}
