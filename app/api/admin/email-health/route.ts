// GET /api/admin/email-health
//
// Read-only Postmark health for the client (milestone) emails. Reports the
// resolved From / Reply-To / BCC / dry-run config and queries Postmark for
// the server identity (DeliveryType: Live vs Sandbox) + outbound stats
// (Sent / Bounced / SpamComplaints). A Live server with Sent > 0 proves
// real client mail is going out. PII-free; no email is sent.
//
// Auth: SYNC_API_SECRET (so the crew portal can proxy it), CRON_SECRET, or
// ADMIN_SEND_SECRET - Bearer header or ?token=.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PM = "https://api.postmarkapp.com";

async function pmGet(path: string, token: string): Promise<unknown> {
  try {
    const res = await fetch(`${PM}${path}`, {
      headers: { "X-Postmark-Server-Token": token, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// The raw Postmark /server response includes the send API tokens + inbound
// address. Whitelist only health-relevant, non-secret fields so this
// diagnostic never echoes a credential.
function safeServer(raw: unknown): unknown {
  const r = raw as {
    ok?: boolean;
    status?: number;
    error?: string;
    body?: Record<string, unknown>;
  };
  if (!r || !r.body) return r;
  const b = r.body;
  return {
    ok: r.ok,
    status: r.status,
    body: {
      ID: b.ID,
      Name: b.Name,
      DeliveryType: b.DeliveryType,
      SmtpApiActivated: b.SmtpApiActivated,
    },
  };
}

export async function GET(req: NextRequest) {
  const accepts = [
    process.env.SYNC_API_SECRET,
    process.env.CRON_SECRET,
    process.env.ADMIN_SEND_SECRET,
  ].filter(Boolean) as string[];
  const auth = req.headers.get("authorization") ?? "";
  const qToken = req.nextUrl.searchParams.get("token") ?? "";
  const ok = accepts.some((s) => auth === `Bearer ${s}` || qToken === s);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = {
    provider: "postmark",
    tokenPresent: !!process.env.POSTMARK_API_TOKEN,
    fromName: process.env.EMAIL_FROM_NAME ?? "Fame",
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? "hello@shoots.fame.so",
    replyTo: process.env.EMAIL_REPLY_TO ?? null,
    bcc: (process.env.EMAIL_BCC ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dryRunActive: !!process.env.EMAIL_DRYRUN_TO,
  };

  const token = process.env.POSTMARK_API_TOKEN;
  if (!token) {
    return NextResponse.json({
      mode: "email-health",
      live: false,
      reason: "POSTMARK_API_TOKEN unset - sends are no-ops (logged, not sent)",
      config,
    });
  }

  const [serverRaw, stats] = await Promise.all([
    pmGet("/server", token),
    pmGet("/stats/outbound", token),
  ]);

  return NextResponse.json({
    mode: "email-health",
    config,
    server: safeServer(serverRaw),
    stats,
  });
}
