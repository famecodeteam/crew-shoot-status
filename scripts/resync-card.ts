// Find a Trello card by shoot-number prefix on the IMPACT board and POST
// to the production /api/admin/resync-card endpoint to re-ingest it.
// Run with: vercel env run --environment=production -- pnpm tsx scripts/resync-card.ts <shootNumber>

import { getBoardCards } from "../lib/trello";

async function main() {
  const arg = process.argv[2];
  const slugOverride = process.argv[3]; // optional
  if (!arg) {
    console.error("usage: resync-card.ts <shootNumberOrCardId> [slugOverride]");
    process.exit(1);
  }

  const boardId = process.env.TRELLO_BOARD_ID;
  const authToken =
    process.env.CRON_SECRET ?? process.env.ADMIN_RESYNC_TOKEN;
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://shoots.fame.so";

  if (!boardId) throw new Error("TRELLO_BOARD_ID unset");
  if (!authToken)
    throw new Error("CRON_SECRET or ADMIN_RESYNC_TOKEN must be set");

  // Looks like a Trello card ID? 24 hex chars.
  const looksLikeCardId = /^[a-f0-9]{24}$/i.test(arg);
  let cardId: string;
  if (looksLikeCardId) {
    cardId = arg;
  } else {
    console.log(`[resync] looking up card by shoot-number "${arg}"...`);
    const cards = await getBoardCards(boardId);
    // Match cards whose name starts with #<arg> (e.g. "#0221c IMPACT")
    const re = new RegExp(`^#${arg}(\\b|[^0-9])`, "i");
    const matches = cards.filter((c) => re.test(c.name));
    if (matches.length === 0) {
      console.error(`[resync] no cards matched "#${arg}"`);
      process.exit(2);
    }
    if (matches.length > 1) {
      console.error(`[resync] multiple matches for "#${arg}":`);
      for (const m of matches) console.error(`  ${m.id}  ${m.name}`);
      process.exit(2);
    }
    cardId = matches[0].id;
    console.log(`[resync] found cardId=${cardId} (${matches[0].name})`);
  }

  const url = `${baseUrl}/api/admin/resync-card`;
  console.log(`[resync] POST ${url}  body={cardId:"${cardId}"}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ cardId, ...(slugOverride ? { slugOverride } : {}) }),
  });
  const text = await res.text();
  console.log(`[resync] ${res.status} ${res.statusText}`);
  console.log(text);
}

main().catch((err) => {
  console.error("[resync] failed:", err);
  process.exit(1);
});
