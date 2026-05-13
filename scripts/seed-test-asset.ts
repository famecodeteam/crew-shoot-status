// One-shot script to seed a test asset on a shoot, pointing at the
// 286MB testimonial MP4 in Drive. Lets us end-to-end test the client
// review page (player + comments + approval) without waiting on the
// member.fame.so editor session to land its upload flow.
//
// Run with prod env (writes to prod Redis):
//
//   pnpm tsx --env-file=.env.production.local scripts/seed-test-asset.ts \\
//     --slug=0214-tiktok-9bee2654
//
// Idempotent: re-runs upsert the same asset slug.

import { upsertAsset } from "../lib/asset-storage";
import { getBySlug } from "../lib/storage";
import type { Asset, AssetVersion } from "../lib/types";

const ASSET_SLUG = "test-reel-d4xc2m";
const DRIVE_FILE_ID = "1cSxFXfQCl-up5rOV8zJFefDU724iTpkp"; // Testimonial Reel v3, 286MB
const DEFAULT_SHOOT_SLUG = "0214-tiktok-9bee2654";

async function main() {
  const slugArg = process.argv.find((a) => a.startsWith("--slug="));
  const shootSlug = slugArg ? slugArg.slice("--slug=".length) : DEFAULT_SHOOT_SLUG;

  const test = await getBySlug(shootSlug);
  if (!test) {
    console.error(`Shoot slug ${shootSlug} not found in store.`);
    process.exit(1);
  }
  console.log(`Seeding asset on ${test.shootNumber} ${test.clientName} (${test.cardId})`);

  const now = new Date().toISOString();
  const version: AssetVersion = {
    n: 1,
    driveFileId: DRIVE_FILE_ID,
    uploadedAt: now,
    uploadedBy: "seed-script",
    sizeBytes: 299_847_807,
    durationSeconds: null,
    filename: "Testimonial Reel v3.mp4",
  };

  await upsertAsset(test.cardId, ASSET_SLUG, (existing): Asset => ({
    slug: ASSET_SLUG,
    name: "Testimonial Reel",
    notes:
      "Test asset for the client video review build. Uses a real 286MB testimonial MP4 from a past shoot.",
    shootCardId: test.cardId,
    rawFileIds: [],
    versions: [version],
    approval: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: "seed-script",
  }));

  console.log(`✓ Seeded asset "Testimonial Reel" with v1.`);
  console.log(`  Review URL: https://shoots.fame.so/${test.slug}/asset/${ASSET_SLUG}`);
  console.log(`  Shoot page: https://shoots.fame.so/${test.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
