// Trello card + board context → Shoot record.
// Pure transform (no I/O) so it's easy to unit-test against fixture cards.

import type { CrewStatus, Shoot } from "./types";
import type {
  TrelloCard,
  TrelloCustomField,
  TrelloList,
} from "./trello";
import { mapList, statusLabel } from "./list-mapping";
import { pickProducer } from "./producer";
import {
  deriveMilestoneDates,
  capMilestonesToStatus,
  projectDeliveredDate,
  type MilestoneDates,
} from "./milestone-dates";
import type { TrelloAction } from "./trello";

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
    depositReceiptUrl: string | null;
    balanceReceiptUrl: string | null;
    footageUrl: string | null;
    footageAssetCount: string | null;
    publicSlug: string | null;
    statusPageUrl: string | null;
    turnaroundDays: string | null;
    clientWhatsappUrl: string | null;
    crewStatus: string | null;
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

  // Fallback aliases - accept either name so a future Trello rename
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
      depositReceiptUrl: findFirst("Deposit Receipt URL", "Deposit Receipt"),
      balanceReceiptUrl: findFirst(
        "Balance Receipt URL",
        "Balance Receipt",
        "Final Receipt URL",
      ),
      // Per-shoot footage index URL (member.fame.so). Written back by
      // member.fame.so to this field when the index is generated.
      footageUrl: findByName("Client Footage URL"),
      // Asset count on the footage index. Written back by member.fame.so
      // when assets land. ANDed with the list-position gate so the
      // Footage section hides while the index has zero assets.
      footageAssetCount: findByName("Footage Asset Count"),
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
      // Per-shoot override for the projected delivery date.
      // Number custom field - when set, replaces the default
      // (5 business days for PP shoots / 1 calendar day for crew-only).
      turnaroundDays: findFirst(
        "Post Prod Turnaround",
        "Turnaround Days",
        "Post-Prod Turnaround",
        "Days to Deliver",
        "Delivery Turnaround",
      ),
      // Client-facing WhatsApp group invite link.
      // Surfaced in the footer; the separate "Crew WhatsApp Group" field
      // is internal and intentionally not exposed here.
      clientWhatsappUrl: findFirst(
        "Client WhatsApp Group",
        "Client Whatsapp Group",
        "Client WhatsApp",
      ),
      // Live crew status (M7 feed-through). Single-select list field
      // written by the crew page when freelancers tap the "I'm on site"
      // etc. buttons. Resolved by NAME per the hand-off spec so a future
      // re-create of the field on the board doesn't break the read.
      crewStatus: findByName("Crew Status"),
    },
  };
}

// Title format per brief: "#NNNN - Client Name". Falls back gracefully.
// Allows letter suffixes on the shoot number (e.g. #0171a / #0171b for
// split-day shoots) since those exist on the live board.
export function parseTitle(name: string): { shootNumber: string; clientName: string } {
  const trimmed = (name || "").trim();
  // Match e.g. "#0190 - genOway", "#0190 – genOway" (en-dash), "#0190 — genOway" (em-dash), "#0171a - Ascom (Sydney)".
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

function readCustomFieldNumber(
  card: TrelloCard,
  fieldId: string | null,
): number | undefined {
  if (!fieldId) return undefined;
  const item = card.customFieldItems?.find((x) => x.idCustomField === fieldId);
  const raw = item?.value?.number;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// List-type fields store the selected option ID on customFieldItems[i].idValue.
// Look up the human label via the field's options.
function readCustomFieldListOption(
  card: TrelloCard,
  fieldId: string | null,
  customFieldsById: Map<string, TrelloCustomField>,
): string {
  if (!fieldId) return "";
  const item = card.customFieldItems?.find((x) => x.idCustomField === fieldId);
  if (!item?.idValue) return "";
  const field = customFieldsById.get(fieldId);
  const opt = field?.options?.find((o) => o.id === item.idValue);
  return opt?.value?.text?.trim() ?? "";
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
  actions?: TrelloAction[],
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
  //
  // Exception: a "card-..." slug is provisional. generateSlug falls back to
  // the literal "card" when the title has no "#NNNN" shoot number yet (e.g.
  // a raw intake-form card synced before a PM tidied the title). Once the
  // title carries a number, regenerate so the public URL gets the proper
  // "NNNN-client-hash" shape instead of being stuck as "card-..." forever.
  const fieldSlug = readCustomFieldText(card, ctx.fieldId.publicSlug);
  const existingIsProvisional = existingSlug?.startsWith("card-") ?? false;
  const slug =
    existingIsProvisional && shootNumber
      ? generateSlug(shootNumber, clientName)
      : existingSlug || fieldSlug || generateSlug(shootNumber, clientName);

  const hasPostProduction = (card.labels ?? []).some(
    (l) => l.name.trim().toLowerCase() === "post production",
  );

  // Shoot type = the first label on the card that isn't "Post Production".
  // Trello allows multiple labels - Podcast, Conference, Event, Corporate,
  // Photography, Social - and we display whichever is listed first.
  const shootType = (card.labels ?? [])
    .map((l) => l.name.trim())
    .find((n) => n && n.toLowerCase() !== "post production");

  // Past milestone dates from action history (if provided). For webhooks
  // and backfills we pass the actions through; if absent we just leave
  // the map empty - the page falls back gracefully.
  //
  // capMilestonesToStatus drops any date that's ahead of the card's
  // CURRENT list - a card that bounced backward (e.g. briefly dragged
  // into "Assets Approved By Client" then back to editing) must not keep
  // a delivered date, which would also block the projected-ETA path.
  const milestoneDates: MilestoneDates = actions
    ? capMilestonesToStatus(deriveMilestoneDates(actions), mapping.status)
    : {};

  const turnaroundOverride = readCustomFieldNumber(card, ctx.fieldId.turnaroundDays);
  const projectedDeliveredDate = milestoneDates.delivered
    ? undefined
    : projectDeliveredDate(shootDate, hasPostProduction, turnaroundOverride);

  // Brief / quote come from Drive (M3). The two Stripe receipts come
  // from manual Trello custom fields - PM pastes them in. (Finished
  // video deliverables are the per-asset video-review feature now, not
  // a single "Final Asset URL" field.)
  const depositReceiptUrl =
    readCustomFieldText(card, ctx.fieldId.depositReceiptUrl) || undefined;
  const balanceReceiptUrl =
    readCustomFieldText(card, ctx.fieldId.balanceReceiptUrl) || undefined;
  const footageUrl =
    readCustomFieldText(card, ctx.fieldId.footageUrl) || undefined;
  const footageAssetCount = readCustomFieldNumber(
    card,
    ctx.fieldId.footageAssetCount,
  );
  const clientWhatsappUrl =
    readCustomFieldText(card, ctx.fieldId.clientWhatsappUrl) || undefined;

  // Crew Status: typed as union for downstream safety, but anything is
  // accepted at runtime - an unknown option just won't trigger a UI
  // branch, which is the right failure mode.
  const crewStatusRaw = readCustomFieldListOption(
    card,
    ctx.fieldId.crewStatus,
    ctx.customFieldsById,
  );
  const crewStatus = (crewStatusRaw || undefined) as CrewStatus | undefined;

  return {
    slug,
    cardId: card.id,
    shootNumber,
    clientName,
    shootType: shootType || undefined,
    location,
    shootDate,
    status: mapping.status,
    statusLabel: statusLabel(mapping.status, crewFirstName, hasPostProduction),
    crew,
    depositReceiptUrl,
    balanceReceiptUrl,
    footageUrl,
    footageAssetCount,
    clientWhatsappUrl,
    producerEmail: pickProducer(card.idMembers).email,
    hasPostProduction,
    crewStatus,
    milestoneDates,
    projectedDeliveredDate,
    trelloListId: list.id,
    trelloListName: list.name,
    updatedAt: new Date().toISOString(),
  };
}
