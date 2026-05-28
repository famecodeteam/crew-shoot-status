// Client review comments for an (asset, version) pair, stored in the
// shared activity stream (shared-KV contract v2 §5).
//
//   GET  -> the version's client comments, oldest-first.
//   POST -> appends a comment_client activity entry; returns the
//           server-issued authorToken for later edit/delete.
//
// Identity is anonymous + unguessable-URL: the name is collected
// client-side, the per-comment authorToken lives in localStorage and in
// the comment-auth:<activityId> side record - never on the shared
// activity entry (the activity list is partly client-readable).
//
// Trello write-back: the FIRST comment on a version notes the shoot's
// Trello card. Subsequent comments don't.
//
// §9 cutover: the read path also surfaces any legacy comments:<slug>:v<N>
// not yet migrated - see readClientComments.

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { appendActivity, setCommentAuth } from "@/lib/activity-storage";
import {
  newClientComment,
  readClientComments,
  toClientComment,
} from "@/lib/activity";
import {
  applyApprovalToAsset,
  makeApproval,
  syncTrelloForShoot,
} from "@/lib/approval";
import { clientVersions } from "@/lib/asset-versions";
import { newAuthorToken } from "@/lib/comment-id";
import { addCardComment } from "@/lib/trello";

export const dynamic = "force-dynamic";

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset: slug, version: vRaw } = await ctx.params;
  const version = parseVersion(vRaw);
  if (!version) return Response.json({ error: "bad version" }, { status: 400 });

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });

  const comments = await readClientComments(lookup.shoot.cardId, slug, version);
  return Response.json({ comments });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset: slug, version: vRaw } = await ctx.params;
  const version = parseVersion(vRaw);
  if (!version) return Response.json({ error: "bad version" }, { status: 400 });

  let body: { authorName?: string; text?: string; timestampSeconds?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const authorName = (body.authorName ?? "").trim();
  const text = (body.text ?? "").trim();
  const ts = Number(body.timestampSeconds ?? 0);
  if (!authorName || authorName.length > 80) {
    return Response.json({ error: "authorName required (≤80 chars)" }, { status: 400 });
  }
  if (!text || text.length > 2000) {
    return Response.json({ error: "text required (≤2000 chars)" }, { status: 400 });
  }
  if (!Number.isFinite(ts) || ts < 0) {
    return Response.json({ error: "timestampSeconds invalid" }, { status: 400 });
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  const cardId = lookup.shoot.cardId;

  // "First comment on this version?" - decided before the write.
  const existing = await readClientComments(cardId, slug, version);
  const isFirst = existing.length === 0;

  const entry = newClientComment({ authorName, text, version, timestampSeconds: ts });
  const authorToken = newAuthorToken();
  await appendActivity(cardId, slug, entry);
  await setCommentAuth(entry.id, {
    authorToken,
    authorIp: req.headers.get("x-forwarded-for") ?? null,
    authorUa: req.headers.get("user-agent") ?? null,
  });

  // First-comment write-back to the Trello card (best-effort).
  if (isFirst) {
    const reviewUrl = reviewUrlFor(lookup.shoot.slug, slug);
    const note = `[${authorName}] left comments on ${lookup.asset.name} (v${version}): ${reviewUrl}`;
    try {
      await addCardComment(cardId, note);
    } catch (err) {
      console.warn("[comments] Trello write-back failed:", (err as Error).message);
    }
  }

  // A client comment is feedback to action - flip the asset to "changes
  // requested" so it surfaces for the editor + CPM (member-side
  // deriveLifecycle reads this approval). Use the latest client-visible
  // version so the verdict counts as current. Best-effort - never block
  // the comment write on it.
  try {
    const visible = clientVersions(lookup.asset);
    const onVersion = visible.length
      ? Math.max(...visible.map((v) => v.n))
      : version;
    await applyApprovalToAsset({
      cardId,
      assetSlug: slug,
      approval: makeApproval({
        status: "changes_requested",
        onVersion,
        authorName,
        changeRequestText: null,
      }),
    });
    await syncTrelloForShoot({ cardId });
  } catch (err) {
    console.warn(
      "[comments] flip to changes-requested failed:",
      (err as Error).message,
    );
  }

  return Response.json({
    comment: toClientComment(entry),
    // The author token lets the client prove ownership on later
    // edit/delete; it is returned once and never echoed to other readers.
    authorToken,
  });
}

function reviewUrlFor(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
