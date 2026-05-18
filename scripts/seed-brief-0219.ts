// Seed .data/briefs.json with a synthetic BriefRecord for Brief #0219
// using the checked-in Docs API fixture. Lets you view /brief/0219-demand-ai
// against `pnpm dev` without standing up the Trello webhook / cron path.
//
//   pnpm tsx scripts/seed-brief-0219.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import type { docs_v1 } from "googleapis";
import { upsertBySlug } from "../lib/brief-storage";
import { parseBriefDoc } from "../lib/parse-brief";

const FIXTURE = path.join(__dirname, "..", "lib", "__fixtures__", "brief-0219.json");
const SLUG = "0219-demand-ai";
const HASH = "db55c1a9";
const DOC_ID = "13BJAnJsb7Fk5END6_jV_QpDIMlokzO3SbFXVPrBDU8Q";
const CARD_ID = "seed_card_0219";
const SHOOT_NUMBER = "#0219";

async function main() {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8")) as docs_v1.Schema$Document;
  const parsed = parseBriefDoc(doc);
  const now = new Date().toISOString();
  await upsertBySlug(SLUG, (existing) => ({
    slug: SLUG,
    hash: HASH,
    docId: DOC_ID,
    cardId: existing?.cardId ?? CARD_ID,
    shootNumber: SHOOT_NUMBER,
    lastSyncedAt: now,
    lastContentHash: "seed",
    parsedJson: parsed,
    lastErrorAt: null,
    lastErrorMessage: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }));
  console.log(`[seed] wrote BriefRecord for ${SLUG}`);
}

main().catch((err) => {
  console.error("seed failed:", err?.stack ?? err);
  process.exit(1);
});
