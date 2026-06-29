// Glue between "the webhook just upserted a card" and "send the
// milestone email for it".
//
// Responsibilities:
//   - Detect which milestone (if any) just got crossed (status changed).
//   - Skip if status moved backwards.
//   - Skip if no client email is plumbed.
//   - Render the right template with the shoot data.
//   - Claim the send via the email tracker (idempotency).
//   - Send via Resend (with retries on retriable errors).
//   - Mark sent / skipped / error.
//
// Called from app/api/trello-webhook/route.ts and from
// scripts/email-dryrun.ts.

import type { Shoot } from "../types";
import type { ShootStatus } from "../../app/[slug]/status";
import {
  claim,
  get as getSent,
  markError,
  markSent,
  markSkipped,
  type EmailMilestone,
} from "../email-tracker";
import { schedule as schedulePending } from "../pending-emails";
import { notifyEmailSent } from "../notify-email-sent";
import { notifyEmailPending } from "../notify-email-pending";
import { notifyEmailSkipped } from "../notify-email-skipped";
import { send } from "./send";
import { renderEmail } from "./render";
import { BookingConfirmedEmail } from "./templates/booking-confirmed";
import { CrewConfirmedEmail } from "./templates/crew-confirmed";
import { ReadyForShootEmail } from "./templates/ready-for-shoot";
import { FootageInEmail } from "./templates/footage-in";
import { AssetsReadyEmail } from "./templates/assets-ready";
import { DeliveredEmail } from "./templates/delivered";

// Pipeline ordering. Used to detect backwards transitions so a card
// briefly dragged to the wrong list (and dragged back) doesn't trigger
// a duplicate email. on-hold sits outside the rank space - it suppresses
// future sends via the on-hold check, not via the rank comparison.
const STATUS_RANK: Record<ShootStatus, number> = {
  "booking-confirmed": 1,
  "searching-for-crew": 2,
  "crew-confirmed": 3,
  "ready-for-shoot": 4,
  "shoot-complete": 5,
  "in-editing": 6,
  "assets-ready": 7,
  delivered: 8,
  "on-hold": 0,
};

// Which Shoot.status values map to which email milestone identifier.
// (Some statuses don't have a corresponding email - see spec §1.)
function milestoneFor(status: Shoot["status"]): EmailMilestone | null {
  switch (status) {
    case "booking-confirmed":
      return "booking-confirmed";
    case "crew-confirmed":
      return "crew-confirmed";
    case "ready-for-shoot":
      return "ready-for-shoot";
    case "in-editing":
      return "footage-in";
    case "assets-ready":
      return "assets-ready";
    case "delivered":
      return "delivered";
    // searching-for-crew, shoot-complete, on-hold: no email
    default:
      return null;
  }
}

// Renders the right milestone email. All six templates are wired up
// for production sends.
async function renderForMilestone(
  milestone: EmailMilestone,
  shoot: Shoot,
  ctx: {
    statusPageUrl: string;
    clientFirstName: string;
    feedbackUrl: string;
  },
): Promise<{ subject: string; html: string; text: string } | null> {
  switch (milestone) {
    case "booking-confirmed": {
      const subject = `Your shoot is booked - here's what happens next ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <BookingConfirmedEmail
          shoot={shoot}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    case "crew-confirmed": {
      const subject = `Meet your crew - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <CrewConfirmedEmail
          shoot={shoot}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    case "ready-for-shoot": {
      // Subject avoids any "tomorrow" / "today" claim because this
      // email is triggered by a Trello list move, not by a cron tied
      // to shoot.shootDate. If the PM moves the card 2-3 days early
      // (which can happen), a "tomorrow" subject would lie. Tom
      // chose Option A from the timing audit: soften the copy.
      const subject = `Your upcoming shoot - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <ReadyForShootEmail
          shoot={shoot}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    case "footage-in": {
      const subject = shoot.hasPostProduction
        ? `Footage is in - editing has started - ${shoot.shootNumber}`
        : `Your raw footage is ready - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <FootageInEmail
          shoot={shoot}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    case "assets-ready": {
      const subject = `Your videos are ready to review - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <AssetsReadyEmail
          shoot={shoot}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    case "delivered": {
      const subject = `How was your Fame shoot? - ${shoot.shootNumber}`;
      const { html, text } = await renderEmail(
        <DeliveredEmail
          shoot={shoot}
          feedbackUrl={ctx.feedbackUrl}
          statusPageUrl={ctx.statusPageUrl}
          clientFirstName={ctx.clientFirstName}
        />,
      );
      return { subject, html, text };
    }
    default:
      return null;
  }
}

// "Your upcoming shoot" only makes sense while the shoot is still ahead.
// This email fires on a list move (card → "Ready for shoot"), not on a date,
// and that move can land on - or after - the shoot day, especially for
// back-to-back recurring shoots (e.g. Tracy Doyle's 0218a-f). Once the shoot
// is today or in the past the heads-up is wrong (the crew already had their
// day-of reminder), so we skip it. Empty/unknown shootDate → allow, so a
// missing date never silently swallows a legitimate send.
function readyForShootIsStale(shoot: Shoot): boolean {
  // Compare date parts only - shootDate is normally "YYYY-MM-DD" but tolerate a
  // full ISO timestamp so a same-day shoot with a time component still counts
  // as today (a plain `<=` on the raw string would treat "...T10:00" as later).
  const d = (shoot.shootDate ?? "").trim().slice(0, 10);
  if (d.length < 10) return false;
  return d <= todayDateStr(); // shoot date is today or earlier → not upcoming
}

// Today as YYYY-MM-DD in Fame's operating timezone (UK), so the "is the shoot
// still upcoming" boundary lands on local midnight rather than UTC's.
function todayDateStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel auto-set, prefer the production alias if it's the prod build.
  return "https://shoots.fame.so";
}

// Best-effort split of "First Last" -> "First". Falls back to empty so
// the greeting block can render "Hi there,".
function firstNameFrom(full: string | undefined): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] || "";
}

export type ScheduleResult = {
  status: "scheduled" | "skipped" | "no-op";
  milestone?: EmailMilestone;
  reason?: string;
  firesAt?: string;
};

export type DispatchResult = {
  status: "sent" | "cancelled" | "skipped" | "error" | "no-op";
  milestone?: EmailMilestone;
  reason?: string;
  recipients?: string[];
  messageId?: string;
};

// Webhook entry: decide whether THIS transition deserves a milestone
// email. If yes, write a pending record into the 15-min buffer queue
// instead of sending now - the email-flush cron picks it up later,
// re-checks the card's current status, and only then sends. The buffer
// catches accidental Trello drags: if the PM moves a card forward by
// mistake and corrects within 15 min, the cron sees the corrected
// state and cancels the send.
//
// `prev` is the shoot record we had BEFORE this webhook event;
// `next` is what we just upserted.
export async function scheduleMilestoneEmail(
  prev: Shoot | null,
  next: Shoot,
): Promise<ScheduleResult> {
  const milestone = milestoneFor(next.status);
  if (!milestone) return { status: "no-op", reason: "status has no email" };

  // No status change -> nothing to do.
  const prevStatus = prev?.status;
  if (prevStatus === next.status) {
    return { status: "no-op", reason: "no status change" };
  }

  // Don't schedule on backwards transitions.
  if (prevStatus && STATUS_RANK[next.status] < STATUS_RANK[prevStatus]) {
    return { status: "no-op", reason: "backwards transition" };
  }

  // "Upcoming shoot" heads-up is pointless once the shoot is today or past -
  // the card just reached "Ready for shoot" late. Record a skip so it shows on
  // the Activity feed instead of silently sending a stale email.
  if (milestone === "ready-for-shoot" && readyForShootIsStale(next)) {
    await markSkipped(next.cardId, milestone, "shoot date is today or in the past");
    await notifyEmailSkipped({
      cardId: next.cardId,
      milestone,
      reason: "shoot already today/past - no upcoming-shoot email",
    });
    return { status: "skipped", milestone, reason: "shoot not upcoming" };
  }

  // Defensive: stored records written before clientEmails existed
  // deserialise without it.
  const recipients = next.clientEmails ?? [];
  if (!recipients.length) {
    console.warn(
      `[email] no clientEmails on ${next.shootNumber} (${next.cardId}); skipping ${milestone}`,
    );
    await markSkipped(next.cardId, milestone, "no client email on Trello card");
    await notifyEmailSkipped({
      cardId: next.cardId,
      milestone,
      reason: "no client email on file",
    });
    return { status: "skipped", milestone, reason: "no client email" };
  }

  // Already sent? Don't re-schedule.
  const sent = await getSent(next.cardId, milestone);
  if (sent?.status === "sent") {
    return { status: "no-op", milestone, reason: "already sent" };
  }

  const { created, firesAt } = await schedulePending({
    cardId: next.cardId,
    shootSlug: next.slug,
    milestone,
    expectedStatus: next.status,
  });

  console.log(
    `[email] ${created ? "scheduled" : "already pending"} ${milestone} for ${next.shootNumber} firesAt=${firesAt}`,
  );

  // Fire once, only when this schedule actually created the pending entry:
  // ping #crew so anyone can review + cancel it from the Activity tab during
  // the 15-min window. Best-effort - never blocks scheduling.
  if (created) {
    await notifyEmailPending({
      cardId: next.cardId,
      milestone,
      shootSlug: next.slug,
      firesAt,
    });
  }

  return { status: "scheduled", milestone, firesAt };
}

// Cron entry: the email-flush cron calls this for each pending record
// past its firesAt. We re-read the live shoot (kept fresh by the
// webhook) and only send if the card is still at the expected status.
// Anything else (card moved on, claim already exists, no template,
// send error) returns a structured result the cron logs.
export async function dispatchPendingEmail(
  shoot: Shoot,
  milestone: EmailMilestone,
  expectedStatus: Shoot["status"],
): Promise<DispatchResult> {
  // Card moved on inside the buffer? Cancel.
  if (shoot.status !== expectedStatus) {
    return {
      status: "cancelled",
      milestone,
      reason: `status moved from ${expectedStatus} -> ${shoot.status} during buffer`,
    };
  }

  // Shoot date reached today/past while this sat in the 15-min buffer (or it
  // was scheduled before the staleness guard shipped) - don't send a stale
  // "upcoming shoot" email.
  if (milestone === "ready-for-shoot" && readyForShootIsStale(shoot)) {
    await markSkipped(shoot.cardId, milestone, "shoot date is today or in the past");
    await notifyEmailSkipped({
      cardId: shoot.cardId,
      milestone,
      reason: "shoot already today/past - no upcoming-shoot email",
    });
    return { status: "skipped", milestone, reason: "shoot not upcoming" };
  }

  // Already sent (paranoia - cron shouldn't see a pending record for
  // a sent milestone, but the check is cheap).
  const sent = await getSent(shoot.cardId, milestone);
  if (sent?.status === "sent") {
    return { status: "no-op", milestone, reason: "already sent" };
  }

  const recipients = shoot.clientEmails ?? [];
  if (!recipients.length) {
    await markSkipped(shoot.cardId, milestone, "no client email on Trello card");
    await notifyEmailSkipped({
      cardId: shoot.cardId,
      milestone,
      reason: "no client email on file",
    });
    return { status: "skipped", milestone, reason: "no client email" };
  }

  // Don't email a provisional status-page slug ("card-..."). It's minted when
  // a card has no #NNNN number yet (a raw intake) and REGENERATES once the
  // number lands - which would dead-link the URL baked into the email. Leave
  // the pending record unclaimed + unmarked so a later cron tick sends it once
  // the slug is final (no notify - this is a transient wait, not a real skip).
  if (shoot.slug.startsWith("card-")) {
    console.log(
      `[email] deferring ${milestone} for ${shoot.cardId} - provisional slug "${shoot.slug}"`,
    );
    return { status: "no-op", milestone, reason: "provisional slug" };
  }

  // Claim the slot - protects against a re-fired cron tick double-
  // processing the same pending record (e.g. if two crons overlap).
  const won = await claim(shoot.cardId, milestone);
  if (!won) {
    return { status: "no-op", milestone, reason: "already claimed" };
  }

  const ctx = {
    statusPageUrl: `${publicBaseUrl()}/${shoot.slug}`,
    feedbackUrl: `${publicBaseUrl()}/feedback/${shoot.slug}`,
    clientFirstName: firstNameFrom(shoot.clientContactName),
  };

  const rendered = await renderForMilestone(milestone, shoot, ctx);
  if (!rendered) {
    await markSkipped(shoot.cardId, milestone, "no template");
    await notifyEmailSkipped({
      cardId: shoot.cardId,
      milestone,
      reason: "no email template",
    });
    return { status: "skipped", milestone, reason: "no template" };
  }

  let attempt = 0;
  let lastError = "unknown";
  while (attempt < 2) {
    const res = await send({
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [
        { name: "milestone", value: milestone },
        { name: "card", value: shoot.cardId },
      ],
    });
    if (res.ok) {
      await markSent(shoot.cardId, milestone, {
        messageId: res.messageId,
        recipients,
      });
      console.log(
        `[email] sent ${milestone} for ${shoot.shootNumber} to ${recipients.join(",")} messageId=${res.messageId}${res.dryRun ? " (dry-run)" : ""}`,
      );
      // Tell the portal so it logs a permanent email_sent activity row (the
      // 15-min countdown vanishes once sent). Skip dry-run - test traffic
      // shouldn't pollute the real audit trail. Best-effort.
      if (!res.dryRun) {
        await notifyEmailSent({
          cardId: shoot.cardId,
          milestone,
          recipient: recipients[0] ?? null,
          messageId: res.messageId,
        });
      }
      return {
        status: "sent",
        milestone,
        recipients,
        messageId: res.messageId,
      };
    }
    lastError = res.error;
    if (!res.retriable) break;
    attempt++;
    await new Promise((r) => setTimeout(r, 1500));
  }

  await markError(shoot.cardId, milestone, lastError);
  console.error(
    `[email] FAILED ${milestone} for ${shoot.shootNumber}: ${lastError}`,
  );
  return { status: "error", milestone, reason: lastError, recipients };
}

// Subject string used in cron logs + the Trello "Email sent: ..."
// comment. Mirrors renderForMilestone's subject logic exactly.
export function subjectForMilestone(
  milestone: EmailMilestone,
  shoot: Shoot,
): string {
  switch (milestone) {
    case "booking-confirmed":
      return `Your shoot is booked - here's what happens next ${shoot.shootNumber}`;
    case "crew-confirmed":
      return `Meet your crew - ${shoot.shootNumber}`;
    case "ready-for-shoot":
      return `Your upcoming shoot - ${shoot.shootNumber}`;
    case "footage-in":
      return shoot.hasPostProduction
        ? `Footage is in - editing has started - ${shoot.shootNumber}`
        : `Your raw footage is ready - ${shoot.shootNumber}`;
    case "assets-ready":
      return `Your videos are ready to review - ${shoot.shootNumber}`;
    case "delivered":
      return `How was your Fame shoot? - ${shoot.shootNumber}`;
  }
}
