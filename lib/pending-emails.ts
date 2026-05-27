// Pending-email queue for the 15-minute "did the PM actually mean to
// move this card" buffer.
//
// Webhook handler writes a pending record on every status-changing
// list move; a cron (/api/cron/email-flush, every 5 min) reads due
// records and re-checks the card's current status before sending.
// If the card moved back (or anywhere else) within the buffer, the
// cron sees the status no longer matches and cancels the send.
//
// Key shape: `pending-email:<cardId>:<milestone>`
// Value:     PendingEmail JSON
//
// Idempotency: each (cardId, milestone) has ONE pending record at a
// time. Re-scheduling for the same key is a no-op (preserves the
// original `firesAt`), so a card moved forward-back-forward inside
// the window still fires at the original time as long as it ends up
// in the right state.

import { Redis } from "@upstash/redis";
import type { ShootStatus } from "../app/[slug]/status";
import type { EmailMilestone } from "./email-tracker";

export type PendingEmail = {
  cardId: string;
  shootSlug: string;
  milestone: EmailMilestone;
  // The status the card was in when scheduling. The cron compares
  // this against the LIVE shoot.status to decide whether to send.
  expectedStatus: ShootStatus;
  scheduledAt: string; // ISO when first scheduled
  firesAt: string;     // ISO when cron should attempt the send
};

// 15 minutes. Catches accidental drags (PM dragged the wrong card,
// or dropped a card a step ahead and corrected). Long enough that
// the cron has multiple ticks to pick it up; short enough that the
// client doesn't notice the delay.
export const PENDING_DELAY_MS = 15 * 60 * 1000;

const KEY_PREFIX = "pending-email:";

function key(cardId: string, milestone: EmailMilestone): string {
  return `${KEY_PREFIX}${cardId}:${milestone}`;
}

let cached: Redis | null = null;
function client(): Redis | null {
  if (cached) return cached;
  const url = process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached = new Redis({ url, token });
  return cached;
}

// Idempotent schedule. Returns `created: true` only if a NEW pending
// record was written. If one already exists for this key, leaves it
// alone (preserves original firesAt) and returns `created: false`.
// 24h ttl so a never-firing webhook doesn't leak forever; the cron
// resolves long before that.
export async function schedule(payload: {
  cardId: string;
  shootSlug: string;
  milestone: EmailMilestone;
  expectedStatus: ShootStatus;
  delayMs?: number;
}): Promise<{ created: boolean; firesAt: string }> {
  const c = client();
  const now = new Date();
  const delay = payload.delayMs ?? PENDING_DELAY_MS;
  const firesAt = new Date(now.getTime() + delay).toISOString();
  if (!c) {
    return { created: true, firesAt };
  }
  const record: PendingEmail = {
    cardId: payload.cardId,
    shootSlug: payload.shootSlug,
    milestone: payload.milestone,
    expectedStatus: payload.expectedStatus,
    scheduledAt: now.toISOString(),
    firesAt,
  };
  // SET NX so we don't overwrite an in-flight pending record. 24h TTL
  // is a belt-and-braces against ever-pending records (the cron will
  // process them well within that window).
  const res = await c.set(key(payload.cardId, payload.milestone), JSON.stringify(record), {
    nx: true,
    ex: 60 * 60 * 24,
  });
  if (res === "OK") return { created: true, firesAt };
  // Already pending - read existing record to return its firesAt.
  const existingRaw = (await c.get(key(payload.cardId, payload.milestone))) as
    | PendingEmail
    | string
    | null;
  const existing =
    typeof existingRaw === "string"
      ? (JSON.parse(existingRaw) as PendingEmail)
      : existingRaw;
  return { created: false, firesAt: existing?.firesAt ?? firesAt };
}

export async function get(
  cardId: string,
  milestone: EmailMilestone,
): Promise<PendingEmail | null> {
  const c = client();
  if (!c) return null;
  const raw = (await c.get(key(cardId, milestone))) as PendingEmail | string | null;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as PendingEmail;
    } catch {
      return null;
    }
  }
  return raw;
}

export async function clear(
  cardId: string,
  milestone: EmailMilestone,
): Promise<void> {
  const c = client();
  if (!c) return;
  await c.del(key(cardId, milestone));
}

// Returns every pending record currently in the store. The cron
// iterates this list and filters by firesAt < now in code so the KV
// query stays a flat KEYS scan - simple, easy to reason about, fine
// for our volume (low tens of cards in pipeline at any time).
export async function listAll(): Promise<PendingEmail[]> {
  const c = client();
  if (!c) return [];
  const keys = await c.keys(`${KEY_PREFIX}*`);
  if (!keys.length) return [];
  const values = await c.mget(...keys);
  const out: PendingEmail[] = [];
  for (const raw of values) {
    if (!raw) continue;
    if (typeof raw === "string") {
      try {
        out.push(JSON.parse(raw) as PendingEmail);
      } catch {
        // skip malformed
      }
    } else {
      out.push(raw as PendingEmail);
    }
  }
  return out;
}
