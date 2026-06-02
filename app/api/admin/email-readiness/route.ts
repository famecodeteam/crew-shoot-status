// GET /api/admin/email-readiness
//
// Read-only ops report: pulls the live delivery.fame.so feed and lists
// every publishable shoot missing a client email (blocks all milestone
// emails) or a contact name (greeting falls back to "Hi there,").
// Nothing is upserted or sent.
//
// Auth: ADMIN_SEND_SECRET bearer (same secret as the manual-send tool).

import { NextResponse, type NextRequest } from "next/server";
import { emailReadinessFromFeed } from "@/lib/sync-from-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.ADMIN_SEND_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await emailReadinessFromFeed();
  return NextResponse.json(report);
}
