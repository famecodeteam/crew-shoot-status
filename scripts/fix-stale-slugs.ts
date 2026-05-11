// One-shot maintenance: drop records from production storage whose slug
// starts with "card-". Those slugs were generated when title parsing fell
// back (no #NNNN matched). Once the titles are fixed, deleting the record
// lets the next backfill regenerate the slug from the corrected title.
//
//   pnpm tsx --env-file=.env.production.local scripts/fix-stale-slugs.ts

import { listAll, deleteByCardId } from "../lib/storage";

async function main() {
  const all = await listAll();
  const stale = all.filter((s) => s.slug.startsWith("card-"));
  console.log(`Found ${stale.length} record(s) with malformed slugs:`);
  for (const s of stale) {
    console.log(`  cardId=${s.cardId}  shootNumber=${s.shootNumber || "(none)"}  slug=${s.slug}`);
  }
  for (const s of stale) {
    await deleteByCardId(s.cardId);
  }
  console.log(`Deleted ${stale.length}. Run \`pnpm backfill\` next to regenerate clean slugs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
