// POST /api/asset/<asset-slug>/request-changes
//
// Body: { authorName: string, text: string, onVersion: number }
//
// Writes the change request to the asset, posts a Trello comment with
// the change description, updates the custom fields, and reverts the
// shoot card to "Assets Shared With Client" if it had been auto-moved
// to Approved earlier.

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { clientVersions } from "@/lib/asset-versions";
import { applyApprovalToAsset, makeApproval, syncTrelloForShoot } from "@/lib/approval";
import { addCardComment } from "@/lib/trello";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string }> },
) {
  const { asset: slug } = await ctx.params;
  let body: { authorName?: string; text?: string; onVersion?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const authorName = (body.authorName ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!authorName || authorName.length > 80) {
    return Response.json({ error: "authorName required (≤80 chars)" }, { status: 400 });
  }
  if (text.length > 4000) {
    return Response.json({ error: "text must be ≤4000 chars" }, { status: 400 });
  }
  const onVersion = Number(body.onVersion);
  if (!Number.isInteger(onVersion) || onVersion < 1) {
    return Response.json({ error: "onVersion required" }, { status: 400 });
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  // Publish gate (contract v2 §4): reject a change request pointed at an
  // unpublished (or nonexistent) version - same no-auth risk as approve.
  if (!clientVersions(lookup.asset).some((v) => v.n === onVersion)) {
    return Response.json({ error: "version not found on asset" }, { status: 400 });
  }

  const approval = makeApproval({
    status: "changes_requested",
    onVersion,
    authorName,
    changeRequestText: text || null,
  });
  const updated = await applyApprovalToAsset({
    cardId: lookup.shoot.cardId,
    assetSlug: slug,
    approval,
  });

  const reviewUrl = clientReviewUrl(lookup.shoot.slug, slug);
  const trelloText = text
    ? `[${authorName}] requested changes on ${lookup.asset.name} (v${onVersion}): ${text}\n${reviewUrl}`
    : `[${authorName}] requested changes on ${lookup.asset.name} (v${onVersion}). See comments on the review page.\n${reviewUrl}`;

  try {
    await addCardComment(lookup.shoot.cardId, trelloText);
  } catch (err) {
    console.warn("[request-changes] Trello card comment failed:", (err as Error).message);
  }
  await syncTrelloForShoot({ cardId: lookup.shoot.cardId });

  return Response.json({ asset: updated });
}

function clientReviewUrl(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
