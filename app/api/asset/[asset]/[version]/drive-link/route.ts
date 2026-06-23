// GET /api/asset/<asset-slug>/v<n>/drive-link
//
// "Open in Google Drive" target for video assets. Video deliverables can
// outrun the serverless time budget streaming through the download proxy, so
// the review page points their Download button straight here instead. We
// resolve the published version to its Drive fileId, ask the portal
// (delivery.fame.so) to share that one file anyone-with-link just-in-time
// (finished deliverables are otherwise kept private), then 302-redirect the
// client to the Drive view page.
//
// Same access model as the download route: only client-visible (published)
// versions, the slug is unguessable, and we never accept a raw fileId from
// the client - we resolve it server-side from the slug + version.

import type { NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { clientVersions } from "@/lib/asset-versions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseVersion(raw: string): number | null {
  const n = Number(raw.replace(/^v/, ""));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ asset: string; version: string }> },
): Promise<Response> {
  const { asset: slug, version: vRaw } = await ctx.params;
  const n = parseVersion(vRaw);
  if (!n) return new Response("bad version", { status: 400 });

  const lookup = await findAssetBySlug(slug);
  if (!lookup) return new Response("unknown asset", { status: 404 });

  const version = clientVersions(lookup.asset).find((v) => v.n === n);
  if (!version?.driveFileId) {
    return new Response("version not available", { status: 404 });
  }

  const secret = process.env.SYNC_API_SECRET?.trim();
  if (!secret) return new Response("drive link unavailable", { status: 503 });
  const portalBase = (() => {
    try {
      return new URL(
        process.env.CREW_FEED_URL ?? "https://delivery.fame.so/api/sync/shoots",
      ).origin;
    } catch {
      return "https://delivery.fame.so";
    }
  })();

  try {
    const resp = await fetch(`${portalBase}/api/client-event/share-asset-file`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({ fileId: version.driveFileId }),
    });
    if (!resp.ok) return new Response("could not prepare link", { status: 502 });
    const j = (await resp.json()) as { url?: string };
    if (!j.url) return new Response("could not prepare link", { status: 502 });
    return Response.redirect(j.url, 302);
  } catch {
    return new Response("could not prepare link", { status: 502 });
  }
}
