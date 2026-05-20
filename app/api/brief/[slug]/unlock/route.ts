// POST /api/brief/<slug>/unlock
// Body: { code: string }
//
// Verifies the supplied code against the brief access code - the shoot
// number (see briefAccessCode). On match, sets an HttpOnly cookie scoped
// to this brief slug; the next SSR pass of /brief/<slug> sees the cookie
// and renders the full content. On mismatch, returns 401 with no cookie
// change.
//
// Cookie is presence-only; the value is meaningless. Soft-lock semantics
// per the spec: friction against casual viewers, not crypto. Lifted from
// Fame's Video Review Tool unlock route — same model.

import type { NextRequest } from "next/server";
import { getBySlug } from "@/lib/brief-storage";
import { briefUnlockCookieName } from "@/lib/brief-passcode";
import { briefAccessCode } from "@/lib/brief-slug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "code required" }, { status: 400 });
  }

  const rec = await getBySlug(slug);
  if (!rec) {
    return Response.json({ error: "unknown brief" }, { status: 404 });
  }

  const accessCode = briefAccessCode(rec.slug, rec.hash);
  if (code.toLowerCase() !== accessCode.toLowerCase()) {
    return Response.json({ error: "wrong code" }, { status: 401 });
  }

  const cookie = [
    `${briefUnlockCookieName(slug)}=1`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  });
}
