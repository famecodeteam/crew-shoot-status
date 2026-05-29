// Pull shoot data from the crew portal's /api/sync/shoots feed and write
// it into our shoot store - replacing the direct Trello board read as the
// source. (The Trello webhook stays active as a fallback for now.)
//
// The feed already mirrors every Trello custom field we need, in a stable
// camelCase shape, so this is a straight field map - no custom-field-id
// resolution. Status → ShootStatus via the same mapList; milestone dates
// come from the feed's per-list timestamps; the producer is resolved from
// the feed's producerEmail. Existing slugs are preserved.

import { mapList, statusLabel } from "./list-mapping";
import {
  capMilestonesToStatus,
  milestoneDatesFromListDates,
  projectDeliveredDate,
} from "./milestone-dates";
import { DEFAULT_PRODUCER, PRODUCERS } from "./producer";
import { getByCardId, upsertByCardId } from "./storage";
import { generateSlug } from "./transform";
import type { CrewStatus, Shoot } from "./types";

const FEED_URL =
  process.env.CREW_FEED_URL?.trim() ||
  "https://delivery.fame.so/api/sync/shoots";

type FeedShoot = {
  cardId: string;
  shootNumber: string | null;
  clientName: string | null;
  status: string | null;
  shootDate: string | null;
  shootLocation: string | null;
  crewMemberName: string | null;
  crewMemberBio: string | null;
  crewMemberPhotoUrl: string | null;
  crewStatus: string | null;
  clientEmail: string | null;
  clientContactName: string | null;
  clientWhatsappGroup: string | null;
  briefUrl: string | null;
  quoteUrl: string | null;
  producerEmail: string | null;
  depositReceiptUrl: string | null;
  balanceReceiptUrl: string | null;
  clientFootageUrl: string | null;
  labels: string[] | null;
  milestoneDates: Record<string, string> | null;
  updatedAt: string | null;
};

function feedToShoot(f: FeedShoot, existingSlug: string | undefined): Shoot | null {
  if (!f.cardId) return null;
  const mapping = mapList(f.status ?? "");
  if (!mapping || !mapping.publishable) return null;

  const shootNumber = f.shootNumber ?? "";
  const clientName = f.clientName ?? "";
  const labels = f.labels ?? [];
  const hasPostProduction = labels.some(
    (l) => l.trim().toLowerCase() === "post production",
  );
  const shootType =
    labels.find((l) => l.trim().toLowerCase() !== "post production") ||
    undefined;

  const crew = f.crewMemberName
    ? {
        name: f.crewMemberName,
        bio: f.crewMemberBio ?? "",
        photoUrl: f.crewMemberPhotoUrl || undefined,
      }
    : undefined;
  const crewFirstName = crew ? crew.name.split(/\s+/)[0] : undefined;

  const clientEmails = f.clientEmail
    ? f.clientEmail
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const milestoneDates = capMilestonesToStatus(
    milestoneDatesFromListDates(f.milestoneDates ?? {}),
    mapping.status,
  );
  const projectedDeliveredDate = milestoneDates.delivered
    ? undefined
    : projectDeliveredDate(f.shootDate ?? "", hasPostProduction, undefined);

  // Preserve an existing, non-provisional slug; otherwise generate one.
  const slug =
    existingSlug && !existingSlug.startsWith("card-")
      ? existingSlug
      : generateSlug(shootNumber, clientName);

  const producer =
    PRODUCERS.find(
      (p) => p.email.toLowerCase() === (f.producerEmail ?? "").toLowerCase(),
    ) ?? DEFAULT_PRODUCER;

  return {
    slug,
    cardId: f.cardId,
    shootNumber,
    clientName,
    shootType: shootType || undefined,
    location: f.shootLocation ?? "",
    shootDate: f.shootDate ?? "",
    status: mapping.status,
    statusLabel: statusLabel(mapping.status, crewFirstName, hasPostProduction),
    crew,
    briefUrl: f.briefUrl || undefined,
    quoteUrl: f.quoteUrl || undefined,
    footageUrl: f.clientFootageUrl || undefined,
    depositReceiptUrl: f.depositReceiptUrl || undefined,
    balanceReceiptUrl: f.balanceReceiptUrl || undefined,
    clientWhatsappUrl: f.clientWhatsappGroup || undefined,
    producerEmail: producer.email,
    producerFirstName: producer.firstName,
    clientEmails,
    clientContactName: f.clientContactName || undefined,
    hasPostProduction,
    crewStatus: (f.crewStatus || undefined) as CrewStatus | undefined,
    milestoneDates,
    projectedDeliveredDate,
    // Trello list bookkeeping - we only carry the human name now.
    trelloListId: "",
    trelloListName: f.status ?? "",
    updatedAt: f.updatedAt ?? new Date().toISOString(),
  };
}

export type FeedSyncSummary = {
  fetched: number;
  upserted: number;
  skipped: number;
  error?: string;
  /** Only in dry-run: a few mapped shoots to eyeball before writing. */
  sample?: Array<Pick<
    Shoot,
    | "slug"
    | "shootNumber"
    | "clientName"
    | "status"
    | "statusLabel"
    | "crewStatus"
    | "clientEmails"
    | "clientContactName"
    | "producerFirstName"
    | "milestoneDates"
  >>;
};

export async function syncFromFeed(opts?: {
  dryRun?: boolean;
}): Promise<FeedSyncSummary> {
  const dryRun = opts?.dryRun ?? false;
  const secret = process.env.SYNC_API_SECRET?.trim();
  if (!secret) {
    return { fetched: 0, upserted: 0, skipped: 0, error: "SYNC_API_SECRET unset" };
  }

  let shoots: FeedShoot[];
  try {
    const res = await fetch(FEED_URL, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return { fetched: 0, upserted: 0, skipped: 0, error: `feed ${res.status}` };
    }
    const body = (await res.json()) as { shoots?: FeedShoot[] };
    shoots = body.shoots ?? [];
  } catch (err) {
    return { fetched: 0, upserted: 0, skipped: 0, error: (err as Error).message };
  }

  let upserted = 0;
  let skipped = 0;
  const sample: FeedSyncSummary["sample"] = [];
  for (const f of shoots) {
    const existing = await getByCardId(f.cardId);
    const shoot = feedToShoot(f, existing?.slug);
    if (!shoot) {
      skipped += 1; // not publishable / no card id - leave existing alone
      continue;
    }
    if (dryRun) {
      if (sample!.length < 5) {
        sample!.push({
          slug: shoot.slug,
          shootNumber: shoot.shootNumber,
          clientName: shoot.clientName,
          status: shoot.status,
          statusLabel: shoot.statusLabel,
          crewStatus: shoot.crewStatus,
          clientEmails: shoot.clientEmails,
          clientContactName: shoot.clientContactName,
          producerFirstName: shoot.producerFirstName,
          milestoneDates: shoot.milestoneDates,
        });
      }
      upserted += 1; // "would upsert"
      continue;
    }
    await upsertByCardId(f.cardId, () => shoot);
    upserted += 1;
  }
  return { fetched: shoots.length, upserted, skipped, ...(dryRun ? { sample } : {}) };
}
