// Comments collection for a (asset, version) pair.
//
//   GET    → returns the list, oldest-first, with author tokens stripped.
//   POST   → appends a new comment; returns the server-issued authorToken
//            so the client can store it for later edit/delete.
//
// Identity: anonymous + unguessable URL. Name is requested client-side
// on first post and stored in localStorage along with the per-comment
// authorToken returned here.
//
// Trello write-back: posting the FIRST comment on a version writes a
// note to the shoot's Trello card. Subsequent comments don't (the
// review URL is the source of truth).

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import {
  appendComment,
  listComments,
} from "@/lib/asset-storage";
import { newAuthorToken, newCommentId } from "@/lib/comment-id";
import { addCardComment } from "@/lib/trello";
import type { Comment } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// What we send to the client — note authorToken is stripped (only the
// original author has it; we never echo it to subsequent readers).
type ClientComment = Omit<Comment, "authorToken" | "authorIp" | "authorUa">;
function strip(c: Comment): ClientComment {
  const { authorToken, authorIp, authorUa, ...rest } = c;
  void authorToken;
  void authorIp;
  void authorUa;
  return rest;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset: slug, version: vRaw } = await ctx.params;
  const version = parseVersion(vRaw);
  if (!version) return Response.json({ error: "bad version" }, { status: 400 });

  const list = await listComments(slug, version);
  return Response.json({ comments: list.map(strip) });
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

  // Detect "this is the first comment on this version" BEFORE writing.
  const existing = await listComments(slug, version);
  const isFirst = existing.length === 0;

  const now = new Date().toISOString();
  const comment: Comment = {
    id: newCommentId(),
    authorName,
    authorToken: newAuthorToken(),
    authorIp: req.headers.get("x-forwarded-for") ?? null,
    authorUa: req.headers.get("user-agent") ?? null,
    text,
    timestampSeconds: ts,
    createdAt: now,
    updatedAt: now,
    resolved: false,
  };

  await appendComment(slug, version, comment);

  // First-comment write-back to the Trello card. Best-effort: if Trello
  // is down, the comment is still saved — the PM might just miss the
  // notification. (Email fallback is deferred per the brief.)
  if (isFirst) {
    const reviewUrl = reviewUrlFor(lookup.shoot.slug, slug);
    const text = `[${authorName}] left comments on ${lookup.asset.name} (v${version}): ${reviewUrl}`;
    try {
      await addCardComment(lookup.shoot.cardId, text);
    } catch (err) {
      console.warn("[comments] Trello write-back failed:", (err as Error).message);
    }
  }

  return Response.json({
    comment: strip(comment),
    // Return the author token so the client can persist it and prove
    // ownership on subsequent edits/deletes.
    authorToken: comment.authorToken,
  });
}

function reviewUrlFor(shootSlug: string, assetSlug: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so").replace(/\/$/, "");
  return `${base}/${shootSlug}/asset/${assetSlug}`;
}
