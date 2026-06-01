// POST /api/admin/reingest-failed
//
// Bulk recovery tool. Walks every asset version and resets any whose
// Cloudflare Stream copy isn't "ready" (status "error", "pending", or
// absent), so the next sync-stream pass re-ingests them from scratch.
//
// Built for recovering after the shared Cloudflare Stream account hits
// its storage/minutes limit: while over the limit, copyFromUrl throws,
// so sync-stream records outcome "failed" but writes NO status onto the
// version - it silently falls back to the slow Drive proxy. Crucially,
// any version that DID get as far as "error" is treated as settled and
// skipped forever by the normal cron, so it can only be re-run by
// clearing it here.
//
// For each non-ready version:
//   1. best-effort delete the partial / errored Stream video (frees space
//      on the now-tight account, avoids orphans)
//   2. clear streamUid / streamStatus / streamError
// The 5-min sync-stream cron (or a manual /api/sync-stream hit) then
// re-runs copyFromUrl on every cleared version. Drive masters untouched.
//
// Body (optional): { dryRun?: boolean } - preview counts without writing.
// Auth: CRON_SECRET or ADMIN_RESYNC_TOKEN bearer (the latter is the
// operator escape hatch, since CRON_SECRET is sensitive and can't be
// pulled to a laptop - same pattern as /api/admin/resync-card).

import { NextResponse, type NextRequest } from "next/server";
import { listAll as listShoots } from "@/lib/storage";
import { getAssetsForShoot, upsertAsset } from "@/lib/asset-storage";
import { deleteVideo } from "@/lib/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type ResetRow = {
  assetSlug: string;
  version: number;
  priorStatus: "error" | "pending" | "absent";
  action: "reset" | "will-retry-via-cron";
  deletedStreamUid: string | null;
};

export async function POST(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_RESYNC_TOKEN;
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (adminToken && auth === `Bearer ${adminToken}`);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    dryRun?: boolean;
    statuses?: Array<"error" | "pending" | "absent">;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine - defaults to a real run
  }
  const dryRun = body.dryRun === true;
  // Which prior states to reset. Default to "error" only: those are the
  // versions the cron treats as settled and skips forever, so they can't
  // recover without an explicit reset. "pending" versions are still being
  // polled by the cron (they resolve to ready/error on their own), and
  // "absent" ones are retried automatically - resetting either just wastes
  // encoding minutes, so they're opt-in. Pass e.g. ["error","pending"] to
  // widen the net.
  const targetStatuses = new Set(body.statuses ?? ["error"]);

  const shoots = await listShoots();
  const byPriorStatus = { error: 0, pending: 0, absent: 0 };
  const rows: ResetRow[] = [];

  for (const shoot of shoots) {
    const assets = await getAssetsForShoot(shoot.cardId);
    for (const asset of assets) {
      for (const v of asset.versions) {
        if (v.streamStatus === "ready") continue; // healthy - leave alone

        const priorStatus: ResetRow["priorStatus"] =
          v.streamStatus === "error"
            ? "error"
            : v.streamStatus === "pending"
              ? "pending"
              : "absent";
        byPriorStatus[priorStatus] += 1;

        // Only act on the prior statuses the caller asked for.
        if (!targetStatuses.has(priorStatus)) continue;

        // An absent-status version with no Stream video is already in the
        // un-ingested state the cron retries automatically - no write
        // needed. Only error/pending, or anything still holding a
        // streamUid, needs an actual reset.
        const needsReset =
          priorStatus !== "absent" || Boolean(v.streamUid);
        if (!needsReset) {
          rows.push({
            assetSlug: asset.slug,
            version: v.n,
            priorStatus,
            action: "will-retry-via-cron",
            deletedStreamUid: null,
          });
          continue;
        }

        if (dryRun) {
          rows.push({
            assetSlug: asset.slug,
            version: v.n,
            priorStatus,
            action: "reset",
            deletedStreamUid: null,
          });
          continue;
        }

        let deletedStreamUid: string | null = null;
        if (v.streamUid) {
          try {
            await deleteVideo(v.streamUid);
            deletedStreamUid = v.streamUid;
          } catch (err) {
            console.warn(
              `[reingest-failed] deleteVideo(${v.streamUid}) failed:`,
              (err as Error).message,
            );
          }
        }

        await upsertAsset(shoot.cardId, asset.slug, (existing) => {
          if (!existing) {
            throw new Error(`asset ${asset.slug} vanished mid-reingest`);
          }
          return {
            ...existing,
            versions: existing.versions.map((ver) =>
              ver.n === v.n
                ? {
                    ...ver,
                    streamUid: null,
                    streamStatus: null,
                    streamError: null,
                  }
                : ver,
            ),
            updatedAt: new Date().toISOString(),
          };
        });

        rows.push({
          assetSlug: asset.slug,
          version: v.n,
          priorStatus,
          action: "reset",
          deletedStreamUid,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    affectedCount: rows.length,
    byPriorStatus,
    rows,
    note: dryRun
      ? "preview only - no changes written"
      : "non-ready versions cleared; sync-stream (cron or manual) will re-ingest them",
  });
}
