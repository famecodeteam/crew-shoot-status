// Single-comment operations: edit + delete + toggle resolved.
//
// Identity is via author token (server-issued on POST, stored client-side
// in localStorage). Edit + delete are only permitted within 10 minutes
// of the comment's creation; after that the comment is locked even for
// the original author. Toggling resolved is permitted by anyone with
// the page URL (the brief says "anyone with access to the page can
// toggle"), so we don't require a token for that.

import type { NextRequest } from "next/server";
import {
  deleteComment as deleteCommentStore,
  listComments,
  updateComment,
} from "@/lib/asset-storage";
import type { Comment } from "@/lib/types";

export const dynamic = "force-dynamic";

const EDIT_WINDOW_MS = 10 * 60 * 1000;

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function withinEditWindow(c: Comment): boolean {
  return Date.now() - new Date(c.createdAt).getTime() <= EDIT_WINDOW_MS;
}

function strip(c: Comment) {
  const { authorToken, authorIp, authorUa, ...rest } = c;
  void authorToken;
  void authorIp;
  void authorUa;
  return rest;
}

async function findComment(
  slug: string,
  version: number,
  id: string,
): Promise<Comment | null> {
  const list = await listComments(slug, version);
  return list.find((c) => c.id === id) ?? null;
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

  const existing = await findComment(slug, version, commentId);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });

  const updates: Partial<Comment> = {};

  // Text edit — author-only, within edit window.
  if (typeof body.text === "string") {
    if (!body.authorToken || body.authorToken !== existing.authorToken) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!withinEditWindow(existing)) {
      return Response.json({ error: "edit window closed" }, { status: 410 });
    }
    const t = body.text.trim();
    if (!t || t.length > 2000) {
      return Response.json({ error: "text required (≤2000 chars)" }, { status: 400 });
    }
    updates.text = t;
    updates.updatedAt = new Date().toISOString();
  }

  // Resolved toggle — anyone with the URL can flip this.
  if (typeof body.resolved === "boolean") {
    updates.resolved = body.resolved;
    // Don't bump updatedAt for resolve toggles — the "(edited)" marker
    // only appears for text edits.
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const updated = await updateComment(slug, version, commentId, (c) => ({
    ...c,
    ...updates,
  }));
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ comment: strip(updated) });
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

  const existing = await findComment(slug, version, commentId);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });

  if (!body.authorToken || body.authorToken !== existing.authorToken) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!withinEditWindow(existing)) {
    return Response.json({ error: "edit window closed" }, { status: 410 });
  }

  await deleteCommentStore(slug, version, commentId);
  return Response.json({ ok: true });
}
