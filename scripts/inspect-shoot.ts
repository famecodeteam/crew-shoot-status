// One-off diagnostic: dump everything we know about a single shoot so we
// can see why a derived/projected date looks wrong.
//   pnpm tsx --env-file=.env.local scripts/inspect-shoot.ts <slug-or-#number>
//
// Works even when the local store doesn't have the record - it falls back
// to finding the card on the board by shoot number.

import {
  getBoardCards,
  getBoardCustomFields,
  getBoardLists,
  getCardActions,
} from "../lib/trello";
import { getBySlug } from "../lib/storage";
import { buildContext, parseTitle } from "../lib/transform";
import {
  deriveMilestoneDates,
  capMilestonesToStatus,
  projectDeliveredDate,
} from "../lib/milestone-dates";
import { mapList } from "../lib/list-mapping";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: inspect-shoot.ts <slug-or-#number>");
    process.exit(1);
  }
  // Shoot number is the leading digits of the slug, or the arg itself.
  const numMatch = arg.match(/(\d{3,5})/);
  const shootNum = numMatch ? `#${numMatch[1]}` : arg;

  let storedCardId: string | null = null;
  const stored = await getBySlug(arg);
  if (stored) {
    storedCardId = stored.cardId;
    console.log("=== STORED Shoot record (this env's store) ===");
    console.log("  shootNumber:           ", stored.shootNumber);
    console.log("  clientName:            ", stored.clientName);
    console.log("  cardId:                ", stored.cardId);
    console.log("  trelloListName:        ", stored.trelloListName);
    console.log("  status:                ", stored.status);
    console.log("  shootDate:             ", stored.shootDate);
    console.log("  hasPostProduction:     ", stored.hasPostProduction);
    console.log("  milestoneDates:        ", JSON.stringify(stored.milestoneDates));
    console.log("  projectedDeliveredDate:", stored.projectedDeliveredDate);
    console.log("  updatedAt:             ", stored.updatedAt);
  } else {
    console.log(`=== Not in this env's store (slug "${arg}") - using live Trello only ===`);
  }

  const boardId = process.env.TRELLO_BOARD_ID!;
  const [lists, customFields, cards] = await Promise.all([
    getBoardLists(boardId),
    getBoardCustomFields(boardId),
    getBoardCards(boardId),
  ]);
  const ctx = buildContext(lists, customFields);

  const card =
    cards.find((c) => c.id === storedCardId) ??
    cards.find((c) => parseTitle(c.name).shootNumber === shootNum);
  if (!card) {
    console.error(`\nNo card on the board matches ${shootNum}`);
    process.exit(1);
  }

  const actions = await getCardActions(card.id);

  console.log("\n=== LIVE Trello card ===");
  console.log("  name:    ", card.name);
  console.log("  cardId:  ", card.id);
  console.log("  closed:  ", card.closed);
  console.log("  idList:  ", card.idList, "->", ctx.listsById.get(card.idList)?.name);
  console.log("  labels:  ", (card.labels ?? []).map((l) => l.name).join(", ") || "(none)");

  const turnaroundFieldId = ctx.fieldId.turnaroundDays;
  console.log("  turnaround field id:  ", turnaroundFieldId ?? "NOT FOUND on board");
  if (turnaroundFieldId) {
    const item = card.customFieldItems?.find(
      (x) => x.idCustomField === turnaroundFieldId,
    );
    console.log("  turnaround field value:", JSON.stringify(item?.value ?? null));
  }

  console.log("\n=== Action history (createCard + list moves), chronological ===");
  const chrono = actions.slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const a of chrono) {
    if (a.type === "createCard") {
      console.log(`  ${a.date}  createCard in "${a.data?.list?.name}"`);
    } else if (a.type === "updateCard") {
      console.log(
        `  ${a.date}  move "${a.data?.listBefore?.name}" -> "${a.data?.listAfter?.name}"`,
      );
    }
  }

  console.log("\n=== Recomputed from CURRENT code + live action history ===");
  const raw = deriveMilestoneDates(actions);
  console.log("  deriveMilestoneDates() [raw]:    ", JSON.stringify(raw));

  const listName = ctx.listsById.get(card.idList)?.name ?? "";
  const mapping = mapList(listName);
  const status = mapping?.status ?? "(non-publishable list)";
  console.log("  current status:                 ", status);

  if (!mapping) {
    console.log("  (card is in a non-publishable list - nothing more to compute)");
    return;
  }

  const capped = capMilestonesToStatus(raw, mapping.status);
  console.log("  capMilestonesToStatus() [capped]:", JSON.stringify(capped));

  const hasPP = (card.labels ?? []).some(
    (l) => l.name.trim().toLowerCase() === "post production",
  );
  const shootDate = (() => {
    const fid = ctx.fieldId.shootDate;
    const it = card.customFieldItems?.find((x) => x.idCustomField === fid);
    return it?.value?.date?.slice(0, 10) ?? "";
  })();
  console.log(`  shootDate=${shootDate}  hasPostProduction=${hasPP}`);
  if (capped.delivered) {
    console.log("  projectedDeliveredDate: (none - capped milestoneDates.delivered is set)");
  } else {
    console.log(
      "  projectedDeliveredDate:          ",
      projectDeliveredDate(shootDate, hasPP),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
