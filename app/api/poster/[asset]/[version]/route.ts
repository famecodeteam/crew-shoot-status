// Client-facing poster image for an asset version, served from the Drive
// file's own thumbnail via the service account.
//
//   /api/poster/<asset-slug>/v<n>
//
// Why this exists: the "real" poster is Cloudflare Stream's thumbnail, but
// that only exists once the sync-stream cron has ingested + transcoded the
// version (streamStatus === "ready"). Until then - and it can lag, fail, or
// simply not have run for older versions - every asset card fell back to a
// dark gradient. But the video itself already plays fine, streamed from
// Drive through /api/video, so a real frame IS available: Drive generates a
// thumbnail for every video. This proxies that thumbnail (SA-authenticated,
// so it works for the private cut without sharing it), giving cards a real
// poster immediately, independent of Stream. The Stream still is preferred
// when ready (higher quality, chosen frame); this is the fallback.
//
// Same publish gate + no-auth model as /api/video: a client can bump <n>,
// so an unpublished version 404s exactly like a missing one.

import type { NextRequest } from "next/server";
import { googleAuth } from "@/lib/google-auth";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { clientVersions } from "@/lib/asset-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset: assetSlug, version: vRaw } = await ctx.params;
  const version = Number(vRaw.replace(/^v/, ""));
  if (!Number.isInteger(version) || version < 1) {
    return new Response("Bad version", { status: 400 });
  }

  const lookup = await findAssetBySlug(assetSlug);
  if (!lookup) return new Response("Unknown asset", { status: 404 });

  // Publish gate (contract v2 §4): only versions the client may see.
  const v = clientVersions(lookup.asset).find((x) => x.n === version);
  if (!v) return new Response("Unknown version", { status: 404 });

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("[poster] auth failed:", err);
    return new Response("Auth failed", { status: 500 });
  }

  // 1. Ask Drive for the file's short-lived thumbnail link. Only populated
  //    once Drive has generated a thumbnail (moments after upload for a
  //    normal video); absent → 404 → the card keeps its gradient.
  const metaUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(v.driveFileId)}` +
    `?fields=thumbnailLink&supportsAllDrives=true`;
  let thumbnailLink: string | undefined;
  try {
    const metaRes = await fetch(metaUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (metaRes.ok) {
      thumbnailLink = ((await metaRes.json()) as { thumbnailLink?: string })
        .thumbnailLink;
    }
  } catch {
    /* fall through to 404 */
  }
  if (!thumbnailLink) return new Response("No thumbnail", { status: 404 });

  // Drive's thumbnailLink comes sized small (e.g. "=s220"); bump it so the
  // card poster stays crisp on retina. Size by a generous width.
  const sized = thumbnailLink.replace(/=s\d+$/, "=s960");

  // 2. Fetch the thumbnail bytes. thumbnailLink is a short-lived, per-request
  //    link whose auth behaviour is inconsistent across Google versions:
  //    sometimes it's pre-signed (loads anonymously), sometimes it wants the
  //    SA bearer. Try authed first, fall back to unauthed, so we work either
  //    way rather than depending on which mode Google is in today.
  let imgRes = await fetch(sized, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  }).catch(() => null);
  if (!imgRes || !imgRes.ok) {
    imgRes = await fetch(sized, { cache: "no-store" }).catch(() => null);
  }
  if (!imgRes || !imgRes.ok || !imgRes.body) {
    return new Response("Thumbnail fetch failed", { status: 502 });
  }

  const out = new Headers();
  out.set("content-type", imgRes.headers.get("content-type") ?? "image/jpeg");
  // Version contents are immutable, so cache hard at the edge. A short-ish
  // max-age hedges the "just uploaded, thumbnail not ready yet" 404 above -
  // once it's a real image the immutable edge copy carries it.
  out.set("cache-control", "public, max-age=3600, s-maxage=86400");

  return new Response(imgRes.body, { status: 200, headers: out });
}
