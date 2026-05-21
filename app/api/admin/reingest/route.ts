// POST /api/admin/reingest
// Body: { assetSlug: string, version: number }
//
// Resets one asset version's Cloudflare Stream state so the next
// sync-stream pass re-ingests it from scratch. Used when an ingest
// stalls - e.g. a multi-GB master whose copy-from-URL never finished -
// and needs re-running (after the video-origin Worker is in place).
//
//   1. best-effort delete the existing Stream video (if any)
//   2. clear streamUid / streamStatus / streamError on the version
// The next /api/sync-stream tick then sees an un-ingested version and
// kicks off a fresh copyFromUrl. Drive is untouched - this only resets
// the derived Stream copy.
//
// Auth: CRON_SECRET as a Bearer token, same as /api/sync-stream.

import { NextResponse, type NextRequest } from "next/server";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { upsertAsset } from "@/lib/asset-storage";
import { deleteVideo } from "@/lib/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: { assetSlug?: string; version?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const assetSlug = (body.assetSlug ?? "").trim();
  const version = Number(body.version);
  if (!assetSlug || !Number.isInteger(version) || version < 1) {
    return NextResponse.json(
      { error: "assetSlug and a positive integer version are required" },
      { status: 400 },
    );
  }

  const lookup = await findAssetBySlug(assetSlug);
  if (!lookup) {
    return NextResponse.json({ error: "unknown asset" }, { status: 404 });
  }
  const v = lookup.asset.versions.find((x) => x.n === version);
  if (!v) {
    return NextResponse.json({ error: "unknown version" }, { status: 404 });
  }

  // Best-effort: drop the stalled / superseded Stream video. If this
  // fails (already gone, transient API error) we still clear the version
  // state - a leftover Stream video is just an orphan the prune reaps.
  let deletedStreamUid: string | null = null;
  if (v.streamUid) {
    try {
      await deleteVideo(v.streamUid);
      deletedStreamUid = v.streamUid;
    } catch (err) {
      console.warn(
        `[reingest] deleteVideo(${v.streamUid}) failed:`,
        (err as Error).message,
      );
    }
  }

  await upsertAsset(lookup.shoot.cardId, assetSlug, (existing) => {
    if (!existing) throw new Error(`asset ${assetSlug} vanished mid-reingest`);
    return {
      ...existing,
      versions: existing.versions.map((ver) =>
        ver.n === version
          ? { ...ver, streamUid: null, streamStatus: null, streamError: null }
          : ver,
      ),
      updatedAt: new Date().toISOString(),
    };
  });

  return NextResponse.json({
    ok: true,
    assetSlug,
    version,
    deletedStreamUid,
    note: "version reset - next sync-stream pass will re-ingest it",
  });
}
