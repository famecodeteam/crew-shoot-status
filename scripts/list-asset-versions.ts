// Diagnostic: dump every asset version with its size, duration, and
// Cloudflare Stream status. Useful for M2/M3 (which videos are ready to
// play from Stream) and for spotting oversized masters.
//   pnpm tsx --env-file=<env-file> scripts/list-asset-versions.ts

import { listAll as listShoots } from "../lib/storage";
import { getAssetsForShoot } from "../lib/asset-storage";

async function main() {
  const shoots = await listShoots();
  let count = 0;
  for (const s of shoots) {
    const assets = await getAssetsForShoot(s.cardId);
    for (const a of assets) {
      for (const v of a.versions) {
        count++;
        const mb = v.sizeBytes
          ? `${(v.sizeBytes / 1e6).toFixed(0)} MB`
          : "?";
        const dur = v.durationSeconds != null ? `${v.durationSeconds}s` : "?";
        console.log(
          `  ${a.slug.padEnd(22)} v${v.n}  ${mb.padStart(9)}  ${dur.padStart(7)}  stream=${(v.streamStatus ?? "-").padEnd(8)} uid=${v.streamUid ?? "-"}`,
        );
      }
    }
  }
  console.log(`\n${count} version(s) across all shoots.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
