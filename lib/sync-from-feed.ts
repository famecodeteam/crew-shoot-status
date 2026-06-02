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
import { scheduleMilestoneEmail } from "./emails/enqueue";
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
  statusPageUrl: string | null;
  labels: string[] | null;
  milestoneDates: Record<string, string> | null;
  updatedAt: string | null;
};

// The client-facing slug is owned by the portal: it lives in the shoot's
// status_page_url - the URL in client emails, bookmarks, and the portal's
// "Client review" links. Honour it so those URLs keep resolving. Earlier
// feed-pulls minted a fresh random slug whenever a shoot wasn't already in
// our store, silently changing live URLs (→ 404s); pinning to the canonical
// slug both repairs those and stops them drifting again.
function slugFromStatusPageUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("shoots.fame.so")) return null;
    return u.pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

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

  // Prefer the portal's canonical client-facing slug; only fall back to an
  // existing non-provisional slug, then a freshly generated one, when the
  // portal has no status-page URL for this shoot.
  const slug =
    slugFromStatusPageUrl(f.statusPageUrl) ??
    (existingSlug && !existingSlug.startsWith("card-")
      ? existingSlug
      : generateSlug(shootNumber, clientName));

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
  /** Milestone emails scheduled this run (status transitions detected). */
  emailsScheduled: number;
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

// Fetch the whole feed once. Shared by syncFromFeed (all cards) and
// refreshOneFromFeed (a single card). Returns null on any failure so
// callers can fall back to whatever's already in KV.
async function fetchFeed(): Promise<FeedShoot[] | null> {
  const secret = process.env.SYNC_API_SECRET?.trim();
  if (!secret) return null;
  try {
    const res = await fetch(FEED_URL, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { shoots?: FeedShoot[] };
    return body.shoots ?? [];
  } catch {
    return null;
  }
}

// Pull the latest data for ONE card from the feed and upsert it into
// KV, returning the mapped Shoot. Used by the manual-send admin
// endpoint so an operator send always acts on current delivery.fame.so
// data (e.g. a client email added moments ago) without waiting for the
// 5-min sync cron. Returns null if the feed is unreachable or the card
// isn't in it - the caller then falls back to the existing KV record.
export async function refreshOneFromFeed(cardId: string): Promise<Shoot | null> {
  const shoots = await fetchFeed();
  if (!shoots) return null;
  const f = shoots.find((s) => s.cardId === cardId);
  if (!f) return null;
  const existing = await getByCardId(cardId);
  const shoot = feedToShoot(f, existing?.slug);
  if (!shoot) return null;
  await upsertByCardId(cardId, () => shoot);
  return shoot;
}

export async function syncFromFeed(opts?: {
  dryRun?: boolean;
}): Promise<FeedSyncSummary> {
  const dryRun = opts?.dryRun ?? false;
  const secret = process.env.SYNC_API_SECRET?.trim();
  if (!secret) {
    return {
      fetched: 0,
      upserted: 0,
      skipped: 0,
      emailsScheduled: 0,
      error: "SYNC_API_SECRET unset",
    };
  }

  let shoots: FeedShoot[];
  try {
    const res = await fetch(FEED_URL, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        fetched: 0,
        upserted: 0,
        skipped: 0,
        emailsScheduled: 0,
        error: `feed ${res.status}`,
      };
    }
    const body = (await res.json()) as { shoots?: FeedShoot[] };
    shoots = body.shoots ?? [];
  } catch (err) {
    return {
      fetched: 0,
      upserted: 0,
      skipped: 0,
      emailsScheduled: 0,
      error: (err as Error).message,
    };
  }

  let upserted = 0;
  let skipped = 0;
  let emailsScheduled = 0;
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

    // Fire the milestone email on a status transition. The Trello
    // webhook used to own this, but the Crew Delivery board is
    // decommissioned - the feed is now the ONLY source of status
    // changes, so the email trigger has to live here too.
    //
    // Safe against a catch-up burst: this sync has been keeping the
    // KV current all along (just without emailing), so for every
    // stable shoot `existing.status` already equals the feed status
    // and scheduleMilestoneEmail no-ops on "no status change". Only
    // transitions that happen AFTER this ships will schedule. The
    // 15-min buffer + per-(card,milestone) idempotency key apply
    // exactly as they did on the webhook path.
    try {
      const r = await scheduleMilestoneEmail(existing, shoot);
      if (r.status === "scheduled") emailsScheduled += 1;
      if (r.status !== "no-op") {
        console.log(
          `[sync-shoots] email ${shoot.shootNumber}: ${r.status} ${r.milestone ?? ""} ${r.reason ?? ""}`.trim(),
        );
      }
    } catch (err) {
      console.warn(
        `[sync-shoots] email schedule failed for ${shoot.shootNumber}:`,
        (err as Error).message,
      );
    }
  }
  return {
    fetched: shoots.length,
    upserted,
    skipped,
    emailsScheduled,
    ...(dryRun ? { sample } : {}),
  };
}
