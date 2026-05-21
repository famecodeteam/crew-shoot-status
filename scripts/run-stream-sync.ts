// Manually run one sync-stream pass - the same logic the cron runs.
// Useful to verify M2 and as an ops trigger (no CRON_SECRET needed; it
// calls the lib directly). Runs against whatever store + PUBLIC_BASE_URL
// the --env-file points at.
//   pnpm tsx --env-file=<env-file> scripts/run-stream-sync.ts

import { syncStreamOnce } from "../lib/sync-stream";

async function main() {
  const summary = await syncStreamOnce(Date.now() + 55_000);
  for (const r of summary.results) {
    console.log(`  ${JSON.stringify(r)}`);
  }
  console.log(
    `\n[run-stream-sync] touched ${summary.total}, timedOut=${summary.timedOut}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[run-stream-sync] failed:", e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
