// POST /api/asset/<asset-slug>/reset-approval
//
// Body: { authorName: string }
//
// Clears the asset's approval (sets it to null), allowing the client
// to re-decide. Posts a Trello comment for audit and re-runs the
// shoot-level sync so the card snaps back to "Assets Shared With Client"
// if it had been auto-moved to Approved.
//
// No author-token requirement - the same trust model as the
// approve / request-changes endpoints (anonymous + unguessable URL).

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { syncTrelloForShoot } from "@/lib/approval";
import { upsertAsset } from "@/lib/asset-storage";
import { addCardComment } from "@/lib/trello";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string }> },
) {
  const { asset: slug } = await ctx.params;
  let body: { authorName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const authorName = (body.authorName ?? "").trim();
  if (!authorName || authorName.length > 80) {
    return Response.json({ error: "authorName required (≤80 chars)" }, { status: 400 });
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  if (!lookup.asset.approval) {
    // Already cleared - idempotent no-op.
    return Response.json({ asset: lookup.asset });
  }

  const previousStatus = lookup.asset.approval.status;
  const previousVersion = lookup.asset.approval.onVersion;

  const updated = await upsertAsset(lookup.shoot.cardId, slug, (existing) => {
    if (!existing) throw new Error("approval target asset not found");
    return {
      ...existing,
      approval: null,
      updatedAt: new Date().toISOString(),
    };
  });

  const reviewUrl = clientReviewUrl(lookup.shoot.slug, slug);
  const wasApproved = previousStatus === "approved";
  const trelloText = wasApproved
    ? `[${authorName}] withdrew approval on ${lookup.asset.name} (v${previousVersion}). ${reviewUrl}`
    : `[${authorName}] retracted the change request on ${lookup.asset.name} (v${previousVersion}). ${reviewUrl}`;

  try {
    await addCardComment(lookup.shoot.cardId, trelloText);
  } catch (err) {
    console.warn("[reset-approval] Trello card comment failed:", (err as Error).message);
  }
  await syncTrelloForShoot({ cardId: lookup.shoot.cardId });

  return Response.json({ asset: updated });
}

function clientReviewUrl(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
