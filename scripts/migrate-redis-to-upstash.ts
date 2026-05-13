// One-shot migration: copy every key we care about from the legacy
// Redis Cloud instance (REDIS_URL) to the shared Upstash KV instance
// (UPSTASH_KV_REST_API_URL / UPSTASH_KV_REST_API_TOKEN). Idempotent -
// re-running just overwrites the destination, which is what we want.
//
// Keys migrated:
//   shoots:store
//   assets:<cardId>           - for every cardId in shoots:store
//   comments:<slug>:v<n>      - discovered via the asset records
//
// Run with both URL/token sets present in .env.production.local (after
// `vercel env pull --environment production`):
//
//   pnpm tsx --env-file=.env.production.local scripts/migrate-redis-to-upstash.ts

import { createClient } from "redis";
import { Redis } from "@upstash/redis";
import type { Asset, Shoot } from "../lib/types";

async function main() {
  const oldUrl = process.env.REDIS_URL;
  const upstashUrl = process.env.UPSTASH_KV_REST_API_URL;
  const upstashToken = process.env.UPSTASH_KV_REST_API_TOKEN;

  if (!oldUrl) throw new Error("REDIS_URL (Redis Cloud) not set");
  if (!upstashUrl || !upstashToken) {
    throw new Error("UPSTASH_KV_REST_API_URL / UPSTASH_KV_REST_API_TOKEN not set");
  }

  console.log("[migrate] source     : Redis Cloud (TCP)");
  console.log("[migrate] destination: Upstash KV (REST)");

  const src = createClient({ url: oldUrl });
  src.on("error", (e) => console.error("[redis] src error:", e));
  await src.connect();

  const dst = new Redis({ url: upstashUrl, token: upstashToken });

  // 1. shoots:store
  const shootsRaw = await src.get("shoots:store");
  if (!shootsRaw) {
    console.log("[migrate] no shoots:store in source - nothing to migrate");
    await src.disconnect();
    return;
  }
  const shoots = JSON.parse(shootsRaw) as Record<string, Shoot>;
  const cardIds = Object.keys(shoots);
  console.log(`[migrate] shoots:store: ${cardIds.length} shoots`);
  await dst.set("shoots:store", JSON.stringify(shoots));
  console.log("[migrate]   ✓ shoots:store");

  // 2. assets:<cardId> for every shoot
  let assetCount = 0;
  const assetSlugs: string[] = [];
  for (const cardId of cardIds) {
    const key = `assets:${cardId}`;
    const raw = await src.get(key);
    if (!raw) continue;
    await dst.set(key, raw);
    const parsed = JSON.parse(raw) as Record<string, Asset>;
    for (const slug of Object.keys(parsed)) {
      assetCount++;
      assetSlugs.push(slug);
    }
  }
  console.log(
    `[migrate] assets:<cardId>: ${assetSlugs.length} keys, ${assetCount} total assets`,
  );

  // 3. comments:<slug>:v<n> - we don't know the version range; scan a
  //    small bounded range (v1..v20). With our scale that's plenty.
  let commentKeyCount = 0;
  let commentCount = 0;
  for (const slug of assetSlugs) {
    for (let v = 1; v <= 20; v++) {
      const key = `comments:${slug}:v${v}`;
      const raw = await src.get(key);
      if (!raw) continue;
      await dst.set(key, raw);
      commentKeyCount++;
      try {
        commentCount += JSON.parse(raw).length;
      } catch {
        // ignore
      }
    }
  }
  console.log(
    `[migrate] comments:<slug>:v<n>: ${commentKeyCount} keys, ${commentCount} total comments`,
  );

  await src.disconnect();
  console.log("[migrate] done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
