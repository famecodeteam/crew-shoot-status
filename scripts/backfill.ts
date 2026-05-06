// pnpm backfill — pulls every card from the Crew Delivery board, runs
// the same transform the webhook will use, and writes one Shoot record
// per card to .data/shoots.json.
//
// Idempotent: re-runs preserve existing slugs (read from the store first,
// fall back to the card's "Public Slug" custom field, then generate).

import {
  getBoardCards,
  getBoardCustomFields,
  getBoardLists,
} from "../lib/trello";
import { listAll, upsertByCardId, deleteByCardId, getByCardId } from "../lib/storage";
import { buildContext, transformCard } from "../lib/transform";
import { findShootDriveLinks, driveServiceAccount } from "../lib/drive";
import { writeBackStatusUrl } from "../lib/writeback";
import type { Shoot } from "../lib/types";

async function main() {
  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    console.error("TRELLO_BOARD_ID is unset. See .env.example.");
    process.exit(1);
  }

  console.log(`[backfill] board: ${boardId}`);

  const [lists, customFields, cards] = await Promise.all([
    getBoardLists(boardId),
    getBoardCustomFields(boardId),
    getBoardCards(boardId),
  ]);

  console.log(
    `[backfill] fetched ${lists.length} lists, ${customFields.length} custom fields, ${cards.length} cards`,
  );

  const ctx = buildContext(lists, customFields);

  // Log which custom fields we resolved (helps Tom add missing ones).
  for (const [key, id] of Object.entries(ctx.fieldId)) {
    console.log(`  customField "${key}": ${id ?? "NOT FOUND on board"}`);
  }

  const seenCardIds = new Set<string>();
  let written = 0;
  let skipped = 0;
  let driveHits = 0;
  let driveMisses = 0;
  let driveErrors = 0;
  let urlWrote = 0;
  let urlSkipped = 0;
  let urlErrors = 0;

  // Probe Drive auth once up front. If it fails, log loudly and skip Drive
  // enrichment entirely — backfill still produces useful pages without
  // brief/quote URLs.
  let driveAvailable = true;
  try {
    console.log(`[backfill] drive: service account = ${driveServiceAccount()}`);
  } catch (err) {
    driveAvailable = false;
    console.warn(
      `[backfill] drive: auth not available — brief/quote lookup skipped (${(err as Error).message.split("\n")[0]})`,
    );
  }

  for (const card of cards) {
    const existing = await getByCardId(card.id);
    const next = transformCard(card, ctx, existing?.slug);
    if (!next) {
      skipped++;
      continue;
    }
    seenCardIds.add(card.id);

    if (driveAvailable && next.shootNumber) {
      try {
        const links = await findShootDriveLinks(next.shootNumber);
        if (links.briefUrl || links.quoteUrl) driveHits++;
        else driveMisses++;
        applyDriveLinks(next, links);
      } catch (err) {
        driveErrors++;
        console.warn(
          `[backfill]   drive lookup failed for ${next.shootNumber}: ${(err as Error).message.split("\n")[0]}`,
        );
      }
    }

    await upsertByCardId(card.id, () => next);
    written++;

    // Write the public URL back to Trello if the field exists. Idempotent.
    try {
      const result = await writeBackStatusUrl(card, ctx, next.slug);
      if (result === "wrote") urlWrote++;
      else urlSkipped++;
    } catch (err) {
      urlErrors++;
      console.warn(
        `[backfill]   url write-back failed for ${next.shootNumber}: ${(err as Error).message.split("\n")[0]}`,
      );
    }
  }

  // Drop records for cards that no longer exist or moved to a non-publishable list.
  const allStored = await listAll();
  let pruned = 0;
  for (const shoot of allStored) {
    if (!seenCardIds.has(shoot.cardId)) {
      await deleteByCardId(shoot.cardId);
      pruned++;
    }
  }

  console.log(
    `[backfill] wrote ${written}, skipped ${skipped} (closed / non-publishable list / unparseable), pruned ${pruned}`,
  );
  if (driveAvailable) {
    console.log(
      `[backfill] drive: ${driveHits} cards with brief/quote, ${driveMisses} folder-not-found-or-empty, ${driveErrors} errors`,
    );
  }
  console.log(
    `[backfill] url-writeback: ${urlWrote} wrote, ${urlSkipped} skipped (already up-to-date or no field/PUBLIC_BASE_URL), ${urlErrors} errors`,
  );

  // Print a quick summary so Tom sees something useful in the terminal.
  const after = await listAll();
  if (after.length === 0) {
    console.log("[backfill] (store is empty)");
    return;
  }
  console.log("");
  console.log("[backfill] current store:");
  for (const s of after.sort((a, b) => a.shootNumber.localeCompare(b.shootNumber))) {
    console.log(
      `  ${s.shootNumber.padEnd(6)} ${s.clientName.padEnd(30)} ${s.trelloListName.padEnd(28)} /${s.slug}`,
    );
  }
}

// Mutates `shoot` in place — we know the type and Drive returns optional fields.
function applyDriveLinks(
  shoot: Shoot,
  links: { briefUrl?: string; quoteUrl?: string },
): void {
  if (links.briefUrl) shoot.briefUrl = links.briefUrl;
  if (links.quoteUrl) shoot.quoteUrl = links.quoteUrl;
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
