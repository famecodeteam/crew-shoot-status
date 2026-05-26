// One-shot backfill: for every shoot that already has a brief Doc
// detected (shoot.briefUrl set), register the BriefRecord and force a
// sync. Without this, brief pages only start appearing as the Trello
// webhook fires for each card naturally — which can be hours/days/never.
//
//   pnpm tsx --env-file=.env.production.local scripts/backfill-briefs.ts
//   pnpm tsx --env-file=.env.production.local scripts/backfill-briefs.ts --dry
//
// --dry → list what would be registered, no writes.

import { listAll as listShoots } from "../lib/storage";
import { registerBrief } from "../lib/brief-storage";
import { getBySlug as getBriefBySlug } from "../lib/brief-storage";
import { extractDocId, shootSlugToBriefSlug } from "../lib/brief-slug";
import { syncOne } from "../lib/sync-brief";

const DRY = process.argv.includes("--dry");

type Plan = {
  shootSlug: string;
  shootNumber: string;
  briefSlug: string;
  hash: string;
  docId: string;
  cardId: string;
};

async function main() {
  const shoots = await listShoots();
  console.log(`[backfill-briefs] ${shoots.length} shoot(s) in store`);

  const plans: Plan[] = [];
  const skipped: { slug: string; reason: string }[] = [];

  for (const s of shoots) {
    if (!s.briefUrl) {
      skipped.push({ slug: s.slug, reason: "no briefUrl" });
      continue;
    }
    const split = shootSlugToBriefSlug(s.slug);
    if (!split) {
      skipped.push({ slug: s.slug, reason: "slug doesn't match -<hash> shape" });
      continue;
    }
    const docId = extractDocId(s.briefUrl);
    if (!docId) {
      skipped.push({ slug: s.slug, reason: `briefUrl not a recognised Doc URL: ${s.briefUrl}` });
      continue;
    }
    plans.push({
      shootSlug: s.slug,
      shootNumber: s.shootNumber || "",
      briefSlug: split.briefSlug,
      hash: split.hash,
      docId,
      cardId: s.cardId,
    });
  }

  console.log(`[backfill-briefs] ${plans.length} brief(s) eligible, ${skipped.length} skipped`);
  if (skipped.length) {
    for (const s of skipped) console.log(`  - skipped ${s.slug}: ${s.reason}`);
  }

  if (DRY) {
    for (const p of plans) {
      const existing = await getBriefBySlug(p.briefSlug);
      const tag = existing ? (existing.parsedJson ? "already synced" : "registered, not synced") : "new";
      console.log(`  - ${p.briefSlug} [${tag}] doc=${p.docId} hash=${p.hash}`);
    }
    console.log("[backfill-briefs] dry run — no writes");
    return;
  }

  let registered = 0;
  let synced = 0;
  let failed = 0;
  for (const p of plans) {
    const reg = await registerBrief({
      briefSlug: p.briefSlug,
      hash: p.hash,
      docId: p.docId,
      cardId: p.cardId,
      shootNumber: p.shootNumber || undefined,
    });
    if (reg.created || reg.updated) registered++;

    // Re-read after register so we have the canonical record (createdAt etc.).
    const rec = await getBriefBySlug(p.briefSlug);
    if (!rec) {
      console.log(`  - ${p.briefSlug}: register returned but record missing (concurrent write?)`);
      failed++;
      continue;
    }
    const result = await syncOne(rec);
    if (result.status === "fetch_error" || result.status === "parse_error") {
      console.log(`  - ${p.briefSlug}: ${result.status} — ${result.error}`);
      failed++;
    } else {
      console.log(`  - ${p.briefSlug}: ${result.status} (${result.durationMs}ms)`);
      synced++;
    }
  }
  console.log(
    `[backfill-briefs] done — registered=${registered} synced=${synced} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill failed:", err?.stack ?? err);
    process.exit(1);
  });
