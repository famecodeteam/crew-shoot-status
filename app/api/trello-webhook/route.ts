// Trello webhook receiver.
//
//   HEAD  /api/trello-webhook → 200 (Trello sends this on registration to verify)
//   POST  /api/trello-webhook → 200 after upserting the changed card
//
// Trello signs each POST with HMAC-SHA1(API_SECRET, payload + callbackURL),
// base64-encoded, in the X-Trello-Webhook header. We verify before touching
// storage. In dev (no TRELLO_WEBHOOK_SECRET set), we skip the check and warn.

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getBoardCustomFields, getBoardLists, getCard } from "@/lib/trello";
import { deleteByCardId, getByCardId, upsertByCardId } from "@/lib/storage";
import { buildContext, transformCard } from "@/lib/transform";
import { findShootDriveLinks } from "@/lib/drive";

// Defer the route to be dynamic — we always need to handle the live POST.
export const dynamic = "force-dynamic";

export async function HEAD() {
  return new Response(null, { status: 200 });
}

// GET added for sanity-checking the URL in a browser during deploy.
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST events from Trello, please" });
}

export async function POST(req: NextRequest) {
  const secret = process.env.TRELLO_WEBHOOK_SECRET;
  const callbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
  const rawBody = await req.text();

  if (secret && callbackUrl) {
    const sig = req.headers.get("x-trello-webhook") ?? "";
    if (!verifyTrelloSignature(rawBody, callbackUrl, secret, sig)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    console.warn(
      "[trello-webhook] TRELLO_WEBHOOK_SECRET or TRELLO_WEBHOOK_CALLBACK_URL unset — skipping signature check (dev only).",
    );
  }

  let payload: TrelloWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const cardId = payload.action?.data?.card?.id;
  if (!cardId) {
    // Non-card events (board edits etc.) — ack and move on.
    return NextResponse.json({ ok: true, ignored: "no card id" });
  }

  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    return NextResponse.json({ error: "TRELLO_BOARD_ID unset" }, { status: 500 });
  }

  // Fetch the live card + a fresh context. Webhooks are infrequent enough
  // that re-fetching lists + customFields per event is fine — keeps the
  // logic simple and avoids stale-context bugs after a board edit.
  const [card, lists, customFields] = await Promise.all([
    getCard(cardId),
    getBoardLists(boardId),
    getBoardCustomFields(boardId),
  ]);

  const ctx = buildContext(lists, customFields);
  const existing = await getByCardId(cardId);
  const next = transformCard(card, ctx, existing?.slug);

  if (!next) {
    // Card moved to a non-publishable list (or was archived). Drop it.
    await deleteByCardId(cardId);
    return NextResponse.json({ ok: true, action: "deleted", cardId });
  }

  // Enrich with brief / quote from Drive. Best-effort — if Drive is down or
  // the SA isn't configured, we still upsert the card with empty link slots
  // and the page just hides those sections.
  if (next.shootNumber) {
    try {
      const links = await findShootDriveLinks(next.shootNumber);
      if (links.briefUrl) next.briefUrl = links.briefUrl;
      if (links.quoteUrl) next.quoteUrl = links.quoteUrl;
    } catch (err) {
      console.warn(
        `[trello-webhook] drive lookup failed for ${next.shootNumber}:`,
        (err as Error).message,
      );
    }
  }

  await upsertByCardId(cardId, () => next);
  return NextResponse.json({ ok: true, action: "upserted", slug: next.slug });
}

function verifyTrelloSignature(
  body: string,
  callbackUrl: string,
  secret: string,
  signature: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret)
    .update(body + callbackUrl)
    .digest("base64");
  // Both are base64; equal byte-length implies equal char-length.
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Minimal shape we care about. Trello sends much more on each event.
type TrelloWebhookPayload = {
  action?: {
    type?: string;
    data?: {
      card?: { id?: string };
      list?: { id?: string };
      board?: { id?: string };
    };
  };
  model?: { id?: string };
};
