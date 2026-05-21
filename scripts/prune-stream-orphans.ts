// Find Cloudflare Stream videos that no AssetVersion references, and
// (with --delete) remove them. Orphans arise when an ingest is
// superseded - e.g. a manual sync run racing the cron's read-modify-
// write, producing a duplicate Stream copy.
//
// Dry-run by default - it only reports. Pass --delete to actually
// remove the orphans (a permanent deletion - run it yourself).
//   pnpm tsx --env-file=<env-file> scripts/prune-stream-orphans.ts
//   pnpm tsx --env-file=<env-file> scripts/prune-stream-orphans.ts --delete

import { listVideos, deleteVideo } from "../lib/stream";
import { listAll as listShoots } from "../lib/storage";
import { getAssetsForShoot } from "../lib/asset-storage";

async function main() {
  const doDelete = process.argv.includes("--delete");

  // Every streamUid currently referenced by an AssetVersion.
  const referenced = new Set<string>();
  for (const shoot of await listShoots()) {
    for (const asset of await getAssetsForShoot(shoot.cardId)) {
      for (const v of asset.versions) {
        if (v.streamUid) referenced.add(v.streamUid);
      }
    }
  }

  const all = await listVideos();
  const orphans = all.filter((v) => !referenced.has(v.uid));

  console.log(
    `Stream account: ${all.length} video(s), ${referenced.size} referenced by an asset, ${orphans.length} orphan(s).`,
  );
  for (const o of orphans) {
    console.log(`  orphan  ${o.uid}  "${o.meta?.name ?? "-"}"  state=${o.status.state}`);
  }

  if (orphans.length === 0) {
    console.log("Nothing to prune.");
    return;
  }
  // Safety: an empty referenced-set almost always means the asset store
  // was unreachable (wrong --env-file) - NOT that nothing is referenced.
  // Deleting then would wipe every video, so refuse.
  if (doDelete && referenced.size === 0) {
    console.error(
      "ABORT: 0 referenced uids - the asset store looks unreachable. " +
        "Refusing to --delete (would remove every video). Check --env-file.",
    );
    process.exit(1);
  }
  if (!doDelete) {
    console.log("\n(dry-run) re-run with --delete to permanently remove the orphans above.");
    return;
  }
  for (const o of orphans) {
    await deleteVideo(o.uid);
    console.log(`  deleted ${o.uid}`);
  }
  console.log(`\nDeleted ${orphans.length} orphan(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
