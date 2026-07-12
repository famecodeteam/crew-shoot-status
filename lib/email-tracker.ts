// Per-shoot per-milestone "this email has been sent" tracker.
//
// Keyed by Trello cardId + the email milestone identifier. Stored in the
// same Upstash project as the shoot data so the webhook handler can
// claim-and-send atomically without a race when Trello bursts two
// events for the same transition.
//
// Key shape: `email-sent:<cardId>:<milestone>` → JSON record:
//   { sentAt: ISO, messageId, recipients: string[], status: "sent" | "skipped" | "error", error? }
//
// We use SET NX on first attempt so the FIRST writer wins; the second
// webhook event sees the marker and no-ops.

import { Redis } from "@upstash/redis";

export type EmailMilestone =
  | "booking-confirmed"
  | "crew-confirmed"
  | "ready-for-shoot"
  | "footage-in"
  | "assets-ready"
  | "delivered"
  // Time-triggered (not a Trello list move): a gentle "your crew is being
  // lined up" note sent while a paid shoot is still pre-crew-confirmed and
  // the date is approaching. Fills the silent gap between booking-confirmed
  // and crew-confirmed so the client doesn't have to chase. See the
  // crew-reassurance cron.
  | "crew-reassurance";

export type SentRecord = {
  sentAt: string;
  messageId: string;
  recipients: string[];
  status: "sent" | "skipped" | "error";
  error?: string;
};

let cached: Redis | null = null;
function client(): Redis | null {
  if (cached) return cached;
  const url = process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached = new Redis({ url, token });
  return cached;
}

function key(cardId: string, milestone: EmailMilestone): string {
  return `email-sent:${cardId}:${milestone}`;
}

// Atomic "claim this send". Returns true if we won the claim (caller
// should proceed to send), false if another worker already claimed it.
// Stores a placeholder `pending` record that markSent / markError
// overwrites once the send completes.
export async function claim(
  cardId: string,
  milestone: EmailMilestone,
): Promise<boolean> {
  const c = client();
  if (!c) return true; // local dev: always claim, idempotency lives elsewhere
  const placeholder: SentRecord = {
    sentAt: new Date().toISOString(),
    messageId: "pending",
    recipients: [],
    status: "sent",
  };
  // NX + 24h expiry on the placeholder. If the send crashes mid-flight
  // the placeholder expires and the next webhook retry can claim it.
  // Successful sends overwrite with a fresh, non-expiring record.
  const res = await c.set(key(cardId, milestone), JSON.stringify(placeholder), {
    nx: true,
    ex: 60 * 60 * 24,
  });
  return res === "OK";
}

export async function get(
  cardId: string,
  milestone: EmailMilestone,
): Promise<SentRecord | null> {
  const c = client();
  if (!c) return null;
  const raw = (await c.get(key(cardId, milestone))) as
    | SentRecord
    | string
    | null;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SentRecord;
    } catch {
      return null;
    }
  }
  return raw;
}

export async function markSent(
  cardId: string,
  milestone: EmailMilestone,
  data: { messageId: string; recipients: string[] },
): Promise<void> {
  const c = client();
  if (!c) return;
  const rec: SentRecord = {
    sentAt: new Date().toISOString(),
    messageId: data.messageId,
    recipients: data.recipients,
    status: "sent",
  };
  // No expiry on the final record - once sent, it stays sent.
  await c.set(key(cardId, milestone), JSON.stringify(rec));
}

export async function markSkipped(
  cardId: string,
  milestone: EmailMilestone,
  reason: string,
): Promise<void> {
  const c = client();
  if (!c) return;
  const rec: SentRecord = {
    sentAt: new Date().toISOString(),
    messageId: "skipped",
    recipients: [],
    status: "skipped",
    error: reason,
  };
  await c.set(key(cardId, milestone), JSON.stringify(rec));
}

export async function markError(
  cardId: string,
  milestone: EmailMilestone,
  error: string,
): Promise<void> {
  const c = client();
  if (!c) return;
  const rec: SentRecord = {
    sentAt: new Date().toISOString(),
    messageId: "error",
    recipients: [],
    status: "error",
    error,
  };
  // Errors expire after 1h so a transient failure can be retried by the
  // next webhook event for the same card.
  await c.set(key(cardId, milestone), JSON.stringify(rec), { ex: 60 * 60 });
}

// Explicit "forget this send" - useful for ops if we need to resend.
export async function clear(
  cardId: string,
  milestone: EmailMilestone,
): Promise<void> {
  const c = client();
  if (!c) return;
  await c.del(key(cardId, milestone));
}
