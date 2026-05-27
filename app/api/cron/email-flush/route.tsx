// Email-flush cron. Runs every 5 minutes (vercel.json), processes
// pending records whose firesAt has passed, and sends - or cancels -
// each based on the card's current state.
//
// Flow:
//   1. List all pending records.
//   2. For each where firesAt < now:
//      a. Look up the live shoot from KV (kept fresh by the webhook).
//      b. dispatchPendingEmail checks current status, claims, renders,
//         sends. Returns one of sent / cancelled / skipped / error.
//      c. On 'sent': post a comment on the Trello card so the PM has
//         an in-context record ("Email sent: <subject>").
//      d. Delete the pending record either way (success OR cancellation
//         OR permanent error).
//
// Auth: CRON_SECRET bearer. Vercel cron sends this header automatically;
// any other caller must include it to invoke.

import { NextResponse, type NextRequest } from "next/server";
import { getByCardId } from "@/lib/storage";
import { addCardComment } from "@/lib/trello";
import {
  dispatchPendingEmail,
  subjectForMilestone,
} from "@/lib/emails/enqueue";
import {
  clear as clearPending,
  listAll as listAllPending,
  type PendingEmail,
} from "@/lib/pending-emails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RunSummary = {
  considered: number;
  sent: number;
  cancelled: number;
  skipped: number;
  errors: number;
  notDue: number;
  results: Array<{
    cardId: string;
    shootSlug: string;
    milestone: string;
    status: string;
    reason?: string;
    messageId?: string;
  }>;
};

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary: RunSummary = {
    considered: 0,
    sent: 0,
    cancelled: 0,
    skipped: 0,
    errors: 0,
    notDue: 0,
    results: [],
  };

  const now = Date.now();
  const pending = await listAllPending();

  for (const p of pending) {
    summary.considered++;

    // Skip records still inside the buffer window - their cron will
    // come.
    if (new Date(p.firesAt).getTime() > now) {
      summary.notDue++;
      continue;
    }

    await processOne(p, summary);
  }

  console.log(
    `[cron/email-flush] considered=${summary.considered} sent=${summary.sent} cancelled=${summary.cancelled} skipped=${summary.skipped} errors=${summary.errors} notDue=${summary.notDue}`,
  );

  return NextResponse.json({ ok: true, ...summary });
}

async function processOne(p: PendingEmail, summary: RunSummary): Promise<void> {
  const shoot = await getByCardId(p.cardId);
  if (!shoot) {
    // Card no longer in our store (archived or moved to a non-
    // publishable list). Treat as cancelled.
    await clearPending(p.cardId, p.milestone);
    summary.cancelled++;
    summary.results.push({
      cardId: p.cardId,
      shootSlug: p.shootSlug,
      milestone: p.milestone,
      status: "cancelled",
      reason: "shoot not found in KV",
    });
    return;
  }

  const result = await dispatchPendingEmail(shoot, p.milestone, p.expectedStatus);
  summary.results.push({
    cardId: p.cardId,
    shootSlug: p.shootSlug,
    milestone: p.milestone,
    status: result.status,
    reason: result.reason,
    messageId: result.messageId,
  });

  if (result.status === "sent") {
    summary.sent++;
    // Best-effort Trello comment so the PM sees in-context "Email
    // sent: ...". Don't fail the cron run if the Trello API is
    // unreachable - the email already went out.
    try {
      const subject = subjectForMilestone(p.milestone, shoot);
      await addCardComment(
        p.cardId,
        `📧 Email sent: ${subject}\nRecipients: ${(result.recipients ?? []).join(", ")}`,
      );
    } catch (err) {
      console.warn(
        `[cron/email-flush] Trello comment failed for ${shoot.shootNumber}:`,
        (err as Error).message,
      );
    }
  } else if (result.status === "cancelled") {
    summary.cancelled++;
  } else if (result.status === "skipped" || result.status === "no-op") {
    summary.skipped++;
  } else if (result.status === "error") {
    summary.errors++;
  }

  // Remove pending record on terminal outcomes. We keep "error"
  // out of this list so transient failures can retry on the next
  // cron tick. The email-tracker stores its own short-TTL error
  // record (1h), so retries naturally back off.
  if (
    result.status === "sent" ||
    result.status === "cancelled" ||
    result.status === "skipped" ||
    result.status === "no-op"
  ) {
    await clearPending(p.cardId, p.milestone);
  }
}
