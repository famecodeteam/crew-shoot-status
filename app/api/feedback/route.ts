// Receives feedback form submissions from /feedback/<slug>.
//
// Storage strategy:
//   1. Mirror to local Upstash KV (`feedback:<cardId>`) - the bedrock,
//      always written. Even if the cross-repo forward fails, we never
//      lose a submission.
//   2. Forward to member.fame.so /api/feedback (the authoritative
//      home, per spec §6.5 - it owns the shared Supabase). Best-effort
//      with one retry; failures log + alert via Slack but don't 500
//      the client.
//
// Notifications:
//   3. Post to Slack #crew via incoming webhook (SLACK_FEEDBACK_WEBHOOK_URL).
//      Best-effort - submission isn't blocked if Slack is down.
//
// No auth on the endpoint itself - the unguessable shoot slug (with
// 8-char hex suffix) acts as the entry token. Same model the brief +
// status pages use.

import { NextResponse, type NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { getBySlug } from "@/lib/storage";
import type { Shoot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  slug?: string;
  cardId?: string;
  shootNumber?: string;
  rating?: number;
  wentWell?: string;
  couldImprove?: string;
  bookAgain?: "yes" | "maybe" | "no" | "";
  other?: string;
};

type StoredRecord = {
  slug: string;
  cardId: string;
  shootNumber: string;
  rating: number;
  wentWell: string;
  couldImprove: string;
  bookAgain: "yes" | "maybe" | "no";
  other: string;
  submittedByIp: string | null;
  submittedByUa: string | null;
  createdAt: string;
  updatedAt: string;
  // Lightweight audit: the prior record (if any), one level deep.
  previous: StoredRecord | null;
  // Cross-repo forward state. "pending" while we haven't tried yet;
  // "ok" / "failed" on completion. Useful for ops debugging.
  forwardedAt: string | null;
  forwardError: string | null;
};

function key(cardId: string): string {
  return `feedback:${cardId}`;
}

let cached: Redis | null = null;
function client(): Redis | null {
  if (cached) return cached;
  const url = process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached = new Redis({ url, token });
  return cached;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { slug, cardId, shootNumber, rating, bookAgain } = body;
  if (!slug || !cardId || !shootNumber) {
    return NextResponse.json(
      { error: "missing slug / cardId / shootNumber" },
      { status: 400 },
    );
  }
  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "rating must be between 1 and 5" },
      { status: 400 },
    );
  }
  if (bookAgain !== "yes" && bookAgain !== "maybe" && bookAgain !== "no") {
    return NextResponse.json(
      { error: "bookAgain must be yes / maybe / no" },
      { status: 400 },
    );
  }

  const shoot = await getBySlug(slug);
  if (!shoot) {
    // The slug is the entry token. Refuse unknown slugs so a probe
    // can't blindly POST junk that gets logged downstream.
    return NextResponse.json({ error: "unknown shoot" }, { status: 404 });
  }
  if (shoot.cardId !== cardId) {
    return NextResponse.json({ error: "slug / cardId mismatch" }, { status: 400 });
  }

  const c = client();
  const now = new Date().toISOString();
  let previous: StoredRecord | null = null;
  if (c) {
    const raw = (await c.get(key(cardId))) as StoredRecord | string | null;
    previous =
      typeof raw === "string" ? (JSON.parse(raw) as StoredRecord) : raw;
  }

  const submittedByIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const submittedByUa = req.headers.get("user-agent") || null;

  const record: StoredRecord = {
    slug,
    cardId,
    shootNumber,
    rating,
    wentWell: (body.wentWell || "").trim(),
    couldImprove: (body.couldImprove || "").trim(),
    bookAgain,
    other: (body.other || "").trim(),
    submittedByIp,
    submittedByUa,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    previous: previous ? { ...previous, previous: null } : null,
    forwardedAt: null,
    forwardError: null,
  };

  // 1. Local persist FIRST so a downstream forward failure can't lose data.
  if (c) {
    await c.set(key(cardId), JSON.stringify(record));
  } else {
    console.warn("[feedback] KV unset - feedback not persisted locally:", body);
  }

  // 2. Cross-repo forward to member.fame.so (best-effort).
  const forwarded = await forwardToMember({
    slug,
    cardId,
    shootNumber,
    clientName: shoot.clientName,
    rating,
    wentWell: record.wentWell,
    couldImprove: record.couldImprove,
    bookAgain,
    other: record.other,
    submittedByIp,
    submittedByUa,
  });
  if (c) {
    record.forwardedAt = forwarded.ok ? now : null;
    record.forwardError = forwarded.ok ? null : forwarded.error;
    await c.set(key(cardId), JSON.stringify(record));
  }

  // 3. Slack #crew notification (best-effort).
  postToSlack(shoot, record).catch((err) => {
    console.warn("[feedback] slack post failed:", (err as Error).message);
  });

  console.log(
    `[feedback] ${shootNumber} rating=${rating} bookAgain=${bookAgain} forwarded=${forwarded.ok}`,
  );

  return NextResponse.json({
    ok: true,
    persisted: !!c,
    forwarded: forwarded.ok,
  });
}

// ---- helpers -------------------------------------------------------

async function forwardToMember(payload: {
  slug: string;
  cardId: string;
  shootNumber: string;
  clientName: string;
  rating: number;
  wentWell: string;
  couldImprove: string;
  bookAgain: "yes" | "maybe" | "no";
  other: string;
  submittedByIp: string | null;
  submittedByUa: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseUrl =
    process.env.MEMBER_API_BASE_URL?.replace(/\/$/, "") ||
    "https://member.fame.so";
  const secret = process.env.FEEDBACK_INGEST_SECRET;
  if (!secret) {
    // Cross-repo unavailable - log + carry on. The local KV write is
    // our durable record; we can backfill once the secret is set on
    // both projects.
    console.warn(
      "[feedback] FEEDBACK_INGEST_SECRET unset - skipping forward to member.fame.so",
    );
    return { ok: false, error: "FEEDBACK_INGEST_SECRET unset" };
  }

  try {
    const res = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function postToSlack(shoot: Shoot, record: StoredRecord): Promise<void> {
  const url = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!url) {
    console.log("[feedback] SLACK_FEEDBACK_WEBHOOK_URL unset - not posting");
    return;
  }

  const stars = "★".repeat(record.rating) + "☆".repeat(5 - record.rating);
  const isNegative = record.rating <= 2 || record.bookAgain === "no";
  const heading = isNegative
    ? `:warning: *Negative feedback* - ${shoot.shootNumber} - ${shoot.clientName}`
    : `*New feedback* - ${shoot.shootNumber} - ${shoot.clientName}`;

  const lines = [
    heading,
    `${stars} (${record.rating}/5) - Would book again: *${record.bookAgain}*`,
  ];
  if (record.wentWell) lines.push(`*Went well:* ${record.wentWell}`);
  if (record.couldImprove) lines.push(`*Could improve:* ${record.couldImprove}`);
  if (record.other) lines.push(`*Other:* ${record.other}`);
  lines.push(`<https://shoots.fame.so/${shoot.slug}|Open status page>`);

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Override the webhook's default "incoming-webhook" identity so the post
    // reads as Fame Bot. Incoming webhooks honour these display overrides.
    body: JSON.stringify({
      username: "Fame Bot",
      icon_emoji: ":movie_camera:",
      text: lines.join("\n"),
    }),
  });
}
