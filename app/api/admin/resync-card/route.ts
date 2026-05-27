// POST /api/admin/resync-card
// Body: { cardId: string }
//
// Manually re-runs the Trello webhook ingest path for one card. Useful
// when a webhook event was missed - e.g. the card was un-archived during
// an Upstash outage and the page is still 404 because the upsert never
// happened. Reusing the webhook's exact pipeline keeps the behaviour
// identical to what a "real" Trello event would produce.
//
// Auth: CRON_SECRET as a Bearer token, same as /api/admin/reingest.

import { NextResponse, type NextRequest } from "next/server";
import {
  getBoardCustomFields,
  getBoardLists,
  getCard,
  getCardActions,
} from "@/lib/trello";
import { deleteByCardId, getByCardId, upsertByCardId } from "@/lib/storage";
import { buildContext, transformCard } from "@/lib/transform";
import { findShootDriveLinks } from "@/lib/drive";
import { writeBackStatusUrl } from "@/lib/writeback";
import { registerBrief } from "@/lib/brief-storage";
import { extractDocId, shootSlugToBriefSlug } from "@/lib/brief-slug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  // Accept CRON_SECRET (matches other admin routes) or a separate
  // ADMIN_RESYNC_TOKEN. The second slot exists because Vercel marks
  // CRON_SECRET as sensitive (can't be pulled to disk), so a known-value
  // override is needed for one-off operator runs from a local machine.
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_RESYNC_TOKEN;
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (adminToken && auth === `Bearer ${adminToken}`);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { cardId?: string; slugOverride?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const cardId = (body.cardId ?? "").trim();
  if (!cardId) {
    return NextResponse.json(
      { error: "cardId required (string)" },
      { status: 400 },
    );
  }
  // Optional slugOverride: force a specific slug (e.g. to restore a URL
  // that was lost when archive deleted the record and the random hash
  // regenerated on un-archive). Validated as our usual slug shape so a
  // typo here can't write garbage as the public URL.
  const slugOverride = (body.slugOverride ?? "").trim() || undefined;
  if (slugOverride && !/^[a-z0-9-]+-[a-f0-9]{8}$/.test(slugOverride)) {
    return NextResponse.json(
      { error: "slugOverride must match <slug>-<8 hex chars>" },
      { status: 400 },
    );
  }

  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    return NextResponse.json(
      { error: "TRELLO_BOARD_ID unset" },
      { status: 500 },
    );
  }

  // Mirror /api/trello-webhook's pipeline so behaviour stays identical.
  const [card, lists, customFields, actions] = await Promise.all([
    getCard(cardId),
    getBoardLists(boardId),
    getBoardCustomFields(boardId),
    getCardActions(cardId).catch((err) => {
      console.warn(
        `[resync-card] action history fetch failed for ${cardId}:`,
        (err as Error).message,
      );
      return undefined;
    }),
  ]);

  const ctx = buildContext(lists, customFields);
  const existing = await getByCardId(cardId);
  // slugOverride wins over the existing/generated slug so an operator can
  // restore a known URL after an archive/un-archive cycle.
  const preferSlug = slugOverride ?? existing?.slug;
  const next = transformCard(card, ctx, preferSlug, actions);

  if (!next) {
    await deleteByCardId(cardId);
    return NextResponse.json({ ok: true, action: "deleted", cardId });
  }

  if (next.shootNumber) {
    try {
      const links = await findShootDriveLinks(next.shootNumber);
      if (links.briefUrl) next.briefUrl = links.briefUrl;
      if (links.quoteUrl) next.quoteUrl = links.quoteUrl;
    } catch (err) {
      console.warn(
        `[resync-card] drive lookup failed for ${next.shootNumber}:`,
        (err as Error).message,
      );
    }
  }

  await upsertByCardId(cardId, () => next);

  if (next.briefUrl) {
    try {
      const docId = extractDocId(next.briefUrl);
      const split = shootSlugToBriefSlug(next.slug);
      if (docId && split) {
        await registerBrief({
          briefSlug: split.briefSlug,
          hash: split.hash,
          docId,
          cardId: next.cardId,
          shootNumber: next.shootNumber || undefined,
        });
      }
    } catch (err) {
      console.warn(
        `[resync-card] brief register failed for ${next.shootNumber}:`,
        (err as Error).message,
      );
    }
  }

  try {
    await writeBackStatusUrl(card, ctx, next.slug);
  } catch (err) {
    console.warn(
      `[resync-card] url write-back failed for ${next.shootNumber}:`,
      (err as Error).message,
    );
  }

  return NextResponse.json({
    ok: true,
    action: "upserted",
    cardId,
    slug: next.slug,
    shootNumber: next.shootNumber,
    clientName: next.clientName,
    status: next.status,
  });
}
