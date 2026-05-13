// Production video proxy. Mirrors the POC at /api/test-video but reads
// the Drive file ID from the asset's versions array in KV rather than
// taking it from a query string. URL shape:
//
//   /api/video/<asset-slug>/v<n>
//
// Authenticates with the SA, forwards Range to Drive, streams back.
// Edge-cached at the Vercel layer; subsequent viewers re-use the cached
// bytes without hitting Drive.

import { google } from "googleapis";
import type { NextRequest } from "next/server";
import { googleAuth } from "@/lib/google-auth";
import { getAssetsForShoot } from "@/lib/asset-storage";
import { listAll } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

let cachedClient: Awaited<ReturnType<typeof getAuthClient>> | null = null;

async function getAuthClient() {
  return googleAuth(DRIVE_SCOPES).getClient();
}

async function getAccessToken(): Promise<string> {
  if (!cachedClient) cachedClient = await getAuthClient();
  const tok = await cachedClient.getAccessToken();
  if (typeof tok === "string") return tok;
  if (tok?.token) return tok.token;
  throw new Error("No Google access token returned");
}

// Asset slugs are globally unique. We find the asset by scanning every
// shoot's assets map until we hit a match. With ~50 shoots × ~5 assets,
// this is cheap and we avoid maintaining a second slug→cardId index. If
// volume grows materially we can add one.
async function findAsset(slug: string) {
  const shoots = await listAll();
  for (const shoot of shoots) {
    const assets = await getAssetsForShoot(shoot.cardId);
    const a = assets.find((x) => x.slug === slug);
    if (a) return a;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; n: string }> },
) {
  const { asset: assetSlug, n: vRaw } = await ctx.params;
  const version = Number(vRaw);
  if (!Number.isInteger(version) || version < 1) {
    return new Response("Bad version", { status: 400 });
  }

  const asset = await findAsset(assetSlug);
  if (!asset) return new Response("Unknown asset", { status: 404 });

  const v = asset.versions.find((x) => x.n === version);
  if (!v) return new Response("Unknown version", { status: 404 });

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("[video] auth failed:", err);
    return new Response("Auth failed", { status: 500 });
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(v.driveFileId)}?alt=media`;
  const range = req.headers.get("range") ?? undefined;

  const upstream = await fetch(driveUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(range ? { range } : {}),
    },
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    const body = await upstream.text().catch(() => "");
    console.error(`[video] drive ${upstream.status}: ${body.slice(0, 200)}`);
    return new Response(`Drive upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const out = new Headers();
  out.set("content-type", upstream.headers.get("content-type") ?? "video/mp4");
  out.set("accept-ranges", "bytes");
  const len = upstream.headers.get("content-length");
  if (len) out.set("content-length", len);
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("content-range", cr);
  // Long edge cache; safe because version contents are immutable.
  out.set("cache-control", "public, max-age=86400, s-maxage=86400, immutable");
  out.set("vary", "range");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
