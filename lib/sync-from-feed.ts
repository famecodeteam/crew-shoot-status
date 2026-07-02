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
import { deleteByCardId, getByCardId, upsertByCardId } from "./storage";
import { registerBrief } from "./brief-storage";
import { extractDocId, shootSlugToBriefSlug } from "./brief-slug";
import { generateSlug } from "./transform";
import { scheduleMilestoneEmail } from "./emails/enqueue";
import type { CrewStatus, Shoot } from "./types";

const FEED_URL =
  process.env.CREW_FEED_URL?.trim() ||
  "https://delivery.fame.so/api/sync/shoots";

// Where to tell the portal the status-page slug we're serving (so it can
// adopt ours when it hasn't minted one). Same origin as the feed - derived
// from FEED_URL so a custom CREW_FEED_URL keeps both in step.
const ADOPT_SLUG_URL = FEED_URL.replace(
  /\/api\/sync\/shoots\/?$/,
  "/api/sync/adopt-status-slug",
);

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
  mustHaveShots: string[] | null;
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
    mustHaveShots: f.mustHaveShots ?? [],
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
  /** Local copies deleted because the portal marked the card retired. */
  retired?: number;
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

// Tell the portal the status-page slug we're already serving for a shoot it
// hasn't minted a status_page_url for, so it adopts ours as canonical. The
// portal owns this slug (see feedToShoot); writing ours back means the CPM
// sees + can share the real client URL and asset review URLs resolve, with
// nothing a client already holds ever changing (zero orphan). Best-effort:
// the portal no-ops if it already has a URL, and on failure it simply learns
// on a later sync while our page keeps serving at this slug regardless.
async function writeBackStatusSlug(
  cardId: string,
  slug: string,
  secret: string,
): Promise<void> {
  if (ADOPT_SLUG_URL === FEED_URL) return; // FEED_URL wasn't the expected shape
  try {
    await fetch(ADOPT_SLUG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      body: JSON.stringify({ cardId, slug }),
    });
  } catch {
    // Non-fatal - see note above.
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

// Email-readiness report: for every publishable shoot in the feed,
// flag whether it has a client email (without which all milestone
// emails silently skip) and a contact name (without which the
// greeting falls back to "Hi there,"). Read-only - does NOT upsert
// or send. Powers /api/admin/email-readiness.
export type ReadinessRow = {
  cardId: string;
  shootNumber: string;
  clientName: string;
  status: string;
  statusLabel: string;
  hasEmail: boolean;
  hasContactName: boolean;
  clientEmails: string[];
};

export async function emailReadinessFromFeed(): Promise<
  | {
      total: number;
      missingEmailCount: number;
      missingContactNameCount: number;
      missingEmail: ReadinessRow[];
      missingContactName: ReadinessRow[];
    }
  | { error: string }
> {
  const shoots = await fetchFeed();
  if (!shoots) return { error: "feed unreachable or SYNC_API_SECRET unset" };

  const rows: ReadinessRow[] = [];
  for (const f of shoots) {
    const shoot = feedToShoot(f, undefined);
    if (!shoot) continue; // non-publishable (pre-Won, unrecognised list)
    rows.push({
      cardId: shoot.cardId,
      shootNumber: shoot.shootNumber,
      clientName: shoot.clientName,
      status: shoot.status,
      statusLabel: shoot.statusLabel,
      hasEmail: (shoot.clientEmails ?? []).length > 0,
      hasContactName: !!shoot.clientContactName,
      clientEmails: shoot.clientEmails ?? [],
    });
  }
  rows.sort((a, b) => a.shootNumber.localeCompare(b.shootNumber));

  return {
    total: rows.length,
    missingEmailCount: rows.filter((r) => !r.hasEmail).length,
    missingContactNameCount: rows.filter((r) => !r.hasContactName).length,
    missingEmail: rows.filter((r) => !r.hasEmail),
    missingContactName: rows.filter((r) => !r.hasContactName),
  };
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
  let retiredCardIds: string[] = [];
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
    const body = (await res.json()) as {
      shoots?: FeedShoot[];
      retiredCardIds?: string[];
    };
    shoots = body.shoots ?? [];
    retiredCardIds = body.retiredCardIds ?? [];
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

    // Zero-orphan backfill: when the portal hasn't minted a status_page_url
    // (older Supabase-era shoots), tell it the slug we're serving so it
    // adopts ours. Once it has one, f.statusPageUrl is set and this no-ops.
    if (!f.statusPageUrl && shoot.slug && !shoot.slug.startsWith("card-")) {
      await writeBackStatusSlug(f.cardId, shoot.slug, secret);
    }

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

    // Register the brief mapping so /brief/[slug] exists and the
    // sync-briefs cron parses it. The Trello webhook used to own this,
    // but the feed is now the only source of shoot data - without this,
    // feed-created shoots never get a BriefRecord, so the status page
    // falls back to the raw Google Doc instead of the hosted HTML brief.
    // Best-effort: a failure here never blocks the shoot upsert.
    if (shoot.briefUrl) {
      try {
        const docId = extractDocId(shoot.briefUrl);
        const split = shootSlugToBriefSlug(shoot.slug);
        if (docId && split) {
          await registerBrief({
            briefSlug: split.briefSlug,
            hash: split.hash,
            docId,
            cardId: shoot.cardId,
            shootNumber: shoot.shootNumber || undefined,
          });
        }
      } catch (err) {
        console.warn(
          `[sync-shoots] brief register failed for ${shoot.shootNumber}:`,
          (err as Error).message,
        );
      }
    }
  }
  // Delete the client's local copy of any shoot the portal has retired
  // (archived / soft-deleted) so its public status page 404s. Reversible:
  // unarchiving re-adds the card to the feed and the next sync re-creates
  // the local copy. Explicit list from the portal, so no risk of pruning a
  // still-active shoot that just blipped out of the feed.
  let retired = 0;
  if (!dryRun) {
    for (const cardId of retiredCardIds) {
      try {
        if (await getByCardId(cardId)) {
          await deleteByCardId(cardId);
          retired += 1;
        }
      } catch (err) {
        console.warn(
          `[sync-shoots] retire-delete failed for ${cardId}:`,
          (err as Error).message,
        );
      }
    }
  }

  return {
    fetched: shoots.length,
    upserted,
    skipped,
    emailsScheduled,
    retired,
    ...(dryRun ? { sample } : {}),
  };
}
