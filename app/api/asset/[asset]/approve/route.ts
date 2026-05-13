// POST /api/asset/<asset-slug>/approve
//
// Body: { authorName: string, note?: string, onVersion: number }
//
// Writes the approval to the asset, posts a Trello comment on the
// shoot card, updates the Asset URLs + Assets Status custom fields,
// and moves the card to "Assets Approved By Client" if all assets on
// the shoot are now approved.

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { applyApprovalToAsset, makeApproval, syncTrelloForShoot } from "@/lib/approval";
import { addCardComment } from "@/lib/trello";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string }> },
) {
  const { asset: slug } = await ctx.params;
  let body: { authorName?: string; note?: string; onVersion?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const authorName = (body.authorName ?? "").trim();
  if (!authorName || authorName.length > 80) {
    return Response.json({ error: "authorName required (≤80 chars)" }, { status: 400 });
  }
  const onVersion = Number(body.onVersion);
  if (!Number.isInteger(onVersion) || onVersion < 1) {
    return Response.json({ error: "onVersion required" }, { status: 400 });
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  if (!lookup.asset.versions.some((v) => v.n === onVersion)) {
    return Response.json({ error: "version not found on asset" }, { status: 400 });
  }

  const approval = makeApproval({
    status: "approved",
    onVersion,
    authorName,
  });
  const updated = await applyApprovalToAsset({
    cardId: lookup.shoot.cardId,
    assetSlug: slug,
    approval,
  });

  const reviewUrl = clientReviewUrl(lookup.shoot.slug, slug);
  const todayHuman = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const trelloText =
    `[${authorName}] approved ${lookup.asset.name} (v${onVersion}) on ${todayHuman}` +
    (body.note?.trim() ? ` — note: ${body.note.trim()}` : "");

  // Trello fan-out (best-effort, can't roll back the approval if Trello fails).
  try {
    await addCardComment(lookup.shoot.cardId, trelloText);
  } catch (err) {
    console.warn("[approve] Trello card comment failed:", (err as Error).message);
  }
  await syncTrelloForShoot({
    cardId: lookup.shoot.cardId,
    changedAssetSlug: slug,
    clientUrlForChangedAsset: reviewUrl,
  });

  return Response.json({ asset: updated });
}

function clientReviewUrl(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
