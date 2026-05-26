// Receives feedback form submissions from /feedback/<slug>. For Phase
// 1 we persist in Upstash (key `feedback:<cardId>`); Phase 4 will
// migrate to the shared Supabase project that backs delivery.fame.so
// per spec §6.5.
//
// Validation is minimal - rating + bookAgain are required, free-text
// fields are optional and trimmed. Resubmissions overwrite the prior
// record (one response per shoot; we keep `updatedAt` and a snapshot
// of the previous payload for auditing).
//
// No auth - the unguessable shoot slug (with 8-char hex suffix) is
// the entry token. Same model the brief / status pages use.

import { NextResponse, type NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

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
  // Snapshot of any prior submission we just overwrote (lightweight
  // audit trail). Null on the first submission.
  previous: StoredRecord | null;
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

  const c = client();
  if (!c) {
    // Local dev or KV not configured - log + accept so the form is
    // still testable.
    console.log("[feedback] KV unset - feedback NOT persisted:", body);
    return NextResponse.json({ ok: true, persisted: false });
  }

  const now = new Date().toISOString();
  const previousRaw = (await c.get(key(cardId))) as
    | StoredRecord
    | string
    | null;
  const previous =
    typeof previousRaw === "string"
      ? (JSON.parse(previousRaw) as StoredRecord)
      : previousRaw;

  const record: StoredRecord = {
    slug,
    cardId,
    shootNumber,
    rating,
    wentWell: (body.wentWell || "").trim(),
    couldImprove: (body.couldImprove || "").trim(),
    bookAgain,
    other: (body.other || "").trim(),
    submittedByIp:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    submittedByUa: req.headers.get("user-agent") || null,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    // Drop nested previous's previous to keep the audit chain to ONE
    // level (we don't need an infinite chain - just the immediate
    // overwrite).
    previous: previous
      ? { ...previous, previous: null }
      : null,
  };

  await c.set(key(cardId), JSON.stringify(record));

  console.log(
    `[feedback] ${shootNumber} (${cardId}): rating=${rating} bookAgain=${bookAgain}`,
  );

  return NextResponse.json({ ok: true, persisted: true });
}
