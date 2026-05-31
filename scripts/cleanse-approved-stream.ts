// One-off backfill: free Cloudflare Stream storage for assets that were
// ALREADY approved before the approve route started releasing Stream
// copies on approval. Going forward the approve route handles this
// automatically; this catches the ones approved earlier.
//
// For every asset whose approval.status === "approved", it deletes that
// asset's version Stream delivery copies and clears streamUid/streamStatus/
// streamError - so the review player falls back to the (slower) Drive
// proxy. Uses the SAME releaseStreamCopiesForAsset() the live approve
// route uses, so behaviour is identical.
//
// Dry-run by default - only reports. Pass --apply to actually delete.
//   pnpm tsx --env-file=<env-file> scripts/cleanse-approved-stream.ts
//   pnpm tsx --env-file=<env-file> scripts/cleanse-approved-stream.ts --apply
//
// Safe to re-run: a cleansed asset has no streamUid left, so it's skipped.
// The sync-stream cron also skips approved assets, so it won't re-ingest
// what this deletes. Only ever touches APPROVED assets' copies - never
// pending/changes-requested work that still needs fast playback.

import { listAll as listShoots } from "../lib/storage";
import { getAssetsForShoot } from "../lib/asset-storage";
import { releaseStreamCopiesForAsset } from "../lib/approval";

async function main() {
  const apply = process.argv.includes("--apply");

  const shoots = await listShoots();
  let approvedWithStream = 0;
  let totalCopies = 0;
  let deleted = 0;
  let failed = 0;

  for (const shoot of shoots) {
    for (const asset of await getAssetsForShoot(shoot.cardId)) {
      if (asset.approval?.status !== "approved") continue;
      const withStream = asset.versions.filter((v) => v.streamUid);
      if (withStream.length === 0) continue;

      approvedWithStream++;
      totalCopies += withStream.length;
      console.log(
        `${apply ? "delete" : "would delete"}  ${asset.slug}  (${shoot.slug})  ` +
          `${withStream.length} copy(ies): ` +
          withStream.map((v) => `v${v.n}=${v.streamUid}`).join(", "),
      );

      if (apply) {
        const res = await releaseStreamCopiesForAsset(shoot.cardId, asset.slug);
        deleted += res.deleted;
        failed += res.failed;
      }
    }
  }

  console.log("");
  if (approvedWithStream === 0) {
    console.log("No approved assets hold Stream copies - nothing to cleanse.");
    return;
  }
  if (apply) {
    console.log(
      `Cleansed ${approvedWithStream} approved asset(s): ${deleted} Stream ` +
        `copy(ies) deleted, ${failed} failed.`,
    );
  } else {
    console.log(
      `${approvedWithStream} approved asset(s) hold ${totalCopies} Stream ` +
        `copy(ies). Re-run with --apply to delete them.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
