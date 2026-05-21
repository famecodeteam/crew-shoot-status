// Single client-comment ops: edit text, toggle resolved, delete.
//
// A comment is a comment_client entry in the shared activity stream.
// Edit/delete capability is the authorToken in the comment-auth:<id>
// side record (server-issued on POST, stored client-side). Edit + delete
// are allowed only within 10 minutes of creation; resolved can be
// toggled by anyone with the page URL.
//
// §9 cutover fallback: a comment id not in the activity stream is an
// un-migrated legacy comments:<assetSlug>:v<N> entry - we fall through
// to the legacy store for it. The whole legacy arm is dropped at §9
// step (c).

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import {
  deleteCommentAuth,
  getCommentAuth,
  listActivity,
  removeActivity,
  replaceActivity,
} from "@/lib/activity-storage";
import { toClientComment } from "@/lib/activity";
import {
  deleteComment as deleteLegacyComment,
  listComments,
  updateComment as updateLegacyComment,
} from "@/lib/asset-storage";
import type { AssetActivity, Comment } from "@/lib/types";

export const dynamic = "force-dynamic";

const EDIT_WINDOW_MS = 10 * 60 * 1000;

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function withinEditWindow(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() <= EDIT_WINDOW_MS;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string; commentId: string }> },
) {
  const { asset: slug, version: vRaw, commentId } = await ctx.params;
  const version = parseVersion(vRaw);
  if (!version) return Response.json({ error: "bad version" }, { status: 400 });

  let body: { text?: string; resolved?: boolean; authorToken?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  const cardId = lookup.shoot.cardId;

  const activity = await listActivity(cardId, slug);
  const entry = activity.find(
    (a) => a.id === commentId && a.type === "comment_client",
  );
  // Not in the activity stream -> un-migrated legacy comment.
  if (!entry) return patchLegacy(slug, version, commentId, body);

  const updates: Partial<AssetActivity> = {};

  // Text edit - author-only, within the edit window.
  if (typeof body.text === "string") {
    const auth = await getCommentAuth(entry.id);
    if (!body.authorToken || !auth || body.authorToken !== auth.authorToken) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!withinEditWindow(entry.createdAt)) {
      return Response.json({ error: "edit window closed" }, { status: 410 });
    }
    const t = body.text.trim();
    if (!t || t.length > 2000) {
      return Response.json({ error: "text required (≤2000 chars)" }, { status: 400 });
    }
    updates.body = t;
    updates.updatedAt = new Date().toISOString();
  }

  // Resolved toggle - anyone with the URL can flip it.
  if (typeof body.resolved === "boolean") {
    updates.resolved = body.resolved;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const updated: AssetActivity = { ...entry, ...updates };
  await replaceActivity(cardId, slug, updated);
  return Response.json({ comment: toClientComment(updated) });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string; commentId: string }> },
) {
  const { asset: slug, version: vRaw, commentId } = await ctx.params;
  const version = parseVersion(vRaw);
  if (!version) return Response.json({ error: "bad version" }, { status: 400 });

  let body: { authorToken?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return Response.json({ error: "unknown asset" }, { status: 404 });
  const cardId = lookup.shoot.cardId;

  const activity = await listActivity(cardId, slug);
  const entry = activity.find(
    (a) => a.id === commentId && a.type === "comment_client",
  );
  if (!entry) return deleteLegacy(slug, version, commentId, body);

  const auth = await getCommentAuth(entry.id);
  if (!body.authorToken || !auth || body.authorToken !== auth.authorToken) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!withinEditWindow(entry.createdAt)) {
    return Response.json({ error: "edit window closed" }, { status: 410 });
  }

  await removeActivity(cardId, slug, entry.id);
  await deleteCommentAuth(entry.id);
  return Response.json({ ok: true });
}

// ---- Legacy comments: fallback (un-migrated entries; §9 step c drops it) ----

async function findLegacy(
  slug: string,
  version: number,
  id: string,
): Promise<Comment | null> {
  const list = await listComments(slug, version);
  return list.find((c) => c.id === id) ?? null;
}

async function patchLegacy(
  slug: string,
  version: number,
  commentId: string,
  body: { text?: string; resolved?: boolean; authorToken?: string },
): Promise<Response> {
  const existing = await findLegacy(slug, version, commentId);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });

  const updates: Partial<Comment> = {};
  if (typeof body.text === "string") {
    if (!body.authorToken || body.authorToken !== existing.authorToken) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!withinEditWindow(existing.createdAt)) {
      return Response.json({ error: "edit window closed" }, { status: 410 });
    }
    const t = body.text.trim();
    if (!t || t.length > 2000) {
      return Response.json({ error: "text required (≤2000 chars)" }, { status: 400 });
    }
    updates.text = t;
    updates.updatedAt = new Date().toISOString();
  }
  if (typeof body.resolved === "boolean") {
    updates.resolved = body.resolved;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }
  const updated = await updateLegacyComment(slug, version, commentId, (c) => ({
    ...c,
    ...updates,
  }));
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  const { authorToken, authorIp, authorUa, ...rest } = updated;
  void authorToken;
  void authorIp;
  void authorUa;
  return Response.json({ comment: rest });
}

async function deleteLegacy(
  slug: string,
  version: number,
  commentId: string,
  body: { authorToken?: string },
): Promise<Response> {
  const existing = await findLegacy(slug, version, commentId);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });
  if (!body.authorToken || body.authorToken !== existing.authorToken) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!withinEditWindow(existing.createdAt)) {
    return Response.json({ error: "edit window closed" }, { status: 410 });
  }
  await deleteLegacyComment(slug, version, commentId);
  return Response.json({ ok: true });
}
