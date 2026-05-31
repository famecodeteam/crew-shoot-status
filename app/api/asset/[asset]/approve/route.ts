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
import { clientVersions } from "@/lib/asset-versions";
import {
  applyApprovalToAsset,
  makeApproval,
  releaseStreamCopiesForAsset,
  syncTrelloForShoot,
} from "@/lib/approval";
import { addCardComment } from "@/lib/trello";
import { appendActivity } from "@/lib/activity-storage";
import { newDecisionNote } from "@/lib/activity";

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
  // Publish gate (contract v2 §4): a client can only decide on a version
  // they can see. onVersion is a client-supplied integer on a no-auth
  // endpoint - reject an approval pointed at an unpublished (or
  // nonexistent) version.
  if (!clientVersions(lookup.asset).some((v) => v.n === onVersion)) {
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

  // Approved → drop the Cloudflare Stream delivery copies and let the
  // player fall back to the Drive proxy (stop paying for Stream once the
  // decision's made). Best-effort - never block the approval write.
  try {
    const released = await releaseStreamCopiesForAsset(lookup.shoot.cardId, slug);
    if (released.deleted || released.failed) {
      console.log(
        `[approve] stream release for ${slug}: ${released.deleted} deleted, ${released.failed} failed`,
      );
    }
  } catch (err) {
    console.warn(
      `[approve] stream release for ${slug} failed:`,
      (err as Error).message,
    );
  }

  // §6: an approval note (optional) also lands in the shared activity
  // stream as a comment_client entry. Best-effort - never block the
  // approval write on it.
  const note = (body.note ?? "").trim();
  if (note) {
    try {
      await appendActivity(
        lookup.shoot.cardId,
        slug,
        newDecisionNote({
          authorName,
          text: note,
          version: onVersion,
          decision: "approved",
        }),
      );
    } catch (err) {
      console.warn(
        "[approve] activity note append failed:",
        (err as Error).message,
      );
    }
  }

  const todayHuman = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const reviewUrl = clientReviewUrl(lookup.shoot.slug, slug);
  const trelloText =
    `[${authorName}] approved ${lookup.asset.name} (v${onVersion}) on ${todayHuman}` +
    (body.note?.trim() ? ` - note: ${body.note.trim()}` : "") +
    `\n${reviewUrl}`;

  // Trello fan-out (best-effort, can't roll back the approval if Trello fails).
  try {
    await addCardComment(lookup.shoot.cardId, trelloText);
  } catch (err) {
    console.warn("[approve] Trello card comment failed:", (err as Error).message);
  }
  await syncTrelloForShoot({ cardId: lookup.shoot.cardId });

  return Response.json({ asset: updated });
}

function clientReviewUrl(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
