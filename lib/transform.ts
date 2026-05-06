// Trello card + board context → Shoot record.
// Pure transform (no I/O) so it's easy to unit-test against fixture cards.

import type { Shoot } from "./types";
import type {
  TrelloCard,
  TrelloCustomField,
  TrelloList,
} from "./trello";
import { mapList, statusLabel } from "./list-mapping";

// Default producer until we add a per-shoot Trello field for it.
const DEFAULT_PRODUCER_EMAIL = "zandro@fame.so";

export type TransformContext = {
  listsById: Map<string, TrelloList>;
  customFieldsById: Map<string, TrelloCustomField>;
  // Custom field IDs we resolved by name. null = field not present on board.
  fieldId: {
    location: string | null;
    shootDate: string | null;
    crewName: string | null;
    crewPhotoUrl: string | null;
    crewBio: string | null;
    finalAssetsUrl: string | null;
    depositReceiptUrl: string | null;
    balanceReceiptUrl: string | null;
    publicSlug: string | null;
    statusPageUrl: string | null;
  };
};

// Build the lookup context once per backfill / webhook batch.
export function buildContext(
  lists: TrelloList[],
  customFields: TrelloCustomField[],
): TransformContext {
  const listsById = new Map(lists.map((l) => [l.id, l]));
  const customFieldsById = new Map(customFields.map((f) => [f.id, f]));

  function findByName(name: string): string | null {
    const lower = name.toLowerCase();
    for (const f of customFields) {
      if (f.name.trim().toLowerCase() === lower) return f.id;
    }
    return null;
  }

  // Fallback aliases — accept either name so a future Trello rename
  // doesn't silently break the page.
  function findFirst(...names: string[]): string | null {
    for (const n of names) {
      const id = findByName(n);
      if (id) return id;
    }
    return null;
  }

  return {
    listsById,
    customFieldsById,
    fieldId: {
      location: findFirst("Location", "Shoot Location"),
      shootDate: findByName("Shoot Date"),
      crewName: findByName("Crew Member Name"),
      crewPhotoUrl: findByName("Crew Member Photo URL"),
      crewBio: findByName("Crew Member Bio"),
      finalAssetsUrl: findFirst("Final Asset URL", "Final Assets URL"),
      depositReceiptUrl: findFirst("Deposit Receipt URL", "Deposit Receipt"),
      balanceReceiptUrl: findFirst(
        "Balance Receipt URL",
        "Balance Receipt",
        "Final Receipt URL",
      ),
      publicSlug: findByName("Public Slug"),
      // Where the auto-generated public URL gets written back so PMs can
      // share it from Trello directly. A handful of aliases so a future
      // rename doesn't silently break the write-back.
      statusPageUrl: findFirst(
        "Status Page URL",
        "Shoot Status URL",
        "Status URL",
        "Public URL",
      ),
    },
  };
}

// Title format per brief: "#NNNN - Client Name". Falls back gracefully.
// Allows letter suffixes on the shoot number (e.g. #0171a / #0171b for
// split-day shoots) since those exist on the live board.
export function parseTitle(name: string): { shootNumber: string; clientName: string } {
  const trimmed = (name || "").trim();
  // Match e.g. "#0190 - genOway", "#0190 — genOway" (em-dash), "#0171a - Ascom (Sydney)".
  const m = trimmed.match(/^(#\d{3,5}[a-z]?)\s*[-–—]\s*(.+)$/i);
  if (m) return { shootNumber: m[1], clientName: m[2].trim() };
  // Loose: number anywhere at start, no dash separator.
  const m2 = trimmed.match(/^(#\d{3,5}[a-z]?)\s+(.+)$/i);
  if (m2) return { shootNumber: m2[1], clientName: m2[2].trim() };
  return { shootNumber: "", clientName: trimmed };
}

function readCustomFieldText(
  card: TrelloCard,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const item = card.customFieldItems?.find((x) => x.idCustomField === fieldId);
  return item?.value?.text?.trim() ?? "";
}

function readCustomFieldDate(
  card: TrelloCard,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const item = card.customFieldItems?.find((x) => x.idCustomField === fieldId);
  const raw = item?.value?.date;
  if (!raw) return "";
  // Trello stores ISO datetime; we want YYYY-MM-DD.
  return raw.slice(0, 10);
}

// Random URL-safe hash. Crypto-strong + slug-friendly.
function randomSlugHash(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientSlugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

// Generate a slug for a card on first sync. Pattern: NNNN-client-xxxxxxxx.
// Brief example: "0203-rios-x7k2m". We use 8 hex chars for less ambiguity.
export function generateSlug(shootNumber: string, clientName: string): string {
  const num = shootNumber.replace(/^#/, "") || "card";
  const client = clientSlugify(clientName) || "shoot";
  return `${num}-${client}-${randomSlugHash()}`;
}

// Decide whether a card should be exposed publicly. Returns null if not
// (e.g. cards in pre-Won lists, or in lists we don't recognise).
export function transformCard(
  card: TrelloCard,
  ctx: TransformContext,
  existingSlug?: string,
): Shoot | null {
  const list = ctx.listsById.get(card.idList);
  if (!list || card.closed) return null;

  const mapping = mapList(list.name);
  if (!mapping || !mapping.publishable) return null;

  const { shootNumber, clientName } = parseTitle(card.name);

  const location = readCustomFieldText(card, ctx.fieldId.location);
  const shootDate = readCustomFieldDate(card, ctx.fieldId.shootDate);

  const crewName = readCustomFieldText(card, ctx.fieldId.crewName);
  const crewPhotoUrl = readCustomFieldText(card, ctx.fieldId.crewPhotoUrl);
  const crewBio = readCustomFieldText(card, ctx.fieldId.crewBio);

  // Crew object only if we have at least the name. Photo + bio optional.
  const crew = crewName
    ? {
        name: crewName,
        bio: crewBio,
        photoUrl: crewPhotoUrl || undefined,
      }
    : undefined;

  const crewFirstName = crew ? crew.name.split(/\s+/)[0] : undefined;

  // Slug: prefer existing (from store), else the Trello custom field, else generate.
  const fieldSlug = readCustomFieldText(card, ctx.fieldId.publicSlug);
  const slug = existingSlug || fieldSlug || generateSlug(shootNumber, clientName);

  const hasPostProduction = (card.labels ?? []).some(
    (l) => l.name.trim().toLowerCase() === "post production",
  );

  // Brief / quote come from Drive (M3). Final assets and the two Stripe
  // receipts come from manual Trello custom fields — PM pastes them in.
  const finalAssetsUrl =
    readCustomFieldText(card, ctx.fieldId.finalAssetsUrl) || undefined;
  const depositReceiptUrl =
    readCustomFieldText(card, ctx.fieldId.depositReceiptUrl) || undefined;
  const balanceReceiptUrl =
    readCustomFieldText(card, ctx.fieldId.balanceReceiptUrl) || undefined;

  return {
    slug,
    cardId: card.id,
    shootNumber,
    clientName,
    location,
    shootDate,
    status: mapping.status,
    statusLabel: statusLabel(mapping.status, crewFirstName),
    crew,
    finalAssetsUrl,
    depositReceiptUrl,
    balanceReceiptUrl,
    producerEmail: DEFAULT_PRODUCER_EMAIL,
    hasPostProduction,
    trelloListId: list.id,
    trelloListName: list.name,
    updatedAt: new Date().toISOString(),
  };
}
