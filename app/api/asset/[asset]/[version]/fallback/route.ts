// POST /api/asset/<asset-slug>/v<n>/fallback
//
// Called by the review page when the in-app proxy download fails. Resolves the
// published version to its Drive fileId, asks the portal (delivery.fame.so) to
// (a) share that one file anyone-with-link just-in-time and (b) alert the
// team, then returns the Drive link to show the client as an escape hatch.
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

export async function POST(
  req: NextRequest,
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
  if (!secret) {
    return Response.json({ error: "fallback unavailable" }, { status: 503 });
  }
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
    const resp = await fetch(`${portalBase}/api/client-event/download-fallback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        cardId: lookup.shoot.cardId,
        assetName: lookup.asset.name,
        version: n,
        clientName: lookup.shoot.clientName ?? null,
        fileId: version.driveFileId,
        reviewUrl: req.headers.get("referer") ?? null,
      }),
    });
    if (!resp.ok) {
      return Response.json({ error: "fallback failed" }, { status: 502 });
    }
    const j = (await resp.json()) as { url?: string };
    if (!j.url) return Response.json({ error: "no link" }, { status: 502 });
    return Response.json({ url: j.url }, { status: 200 });
  } catch {
    return Response.json({ error: "fallback failed" }, { status: 502 });
  }
}
