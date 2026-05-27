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
  markError,
  markSent,
  markSkipped,
  type EmailMilestone,
} from "../email-tracker";
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

export type EnqueueResult = {
  status: "sent" | "skipped" | "error" | "no-op";
  milestone?: EmailMilestone;
  reason?: string;
  recipients?: string[];
  messageId?: string;
};

// Public entry: decide whether to send for this card transition, and
// send (or skip) accordingly.
//
// `prev` is the shoot record we had BEFORE this webhook event;
// `next` is what we just upserted.
export async function enqueueMilestoneEmail(
  prev: Shoot | null,
  next: Shoot,
): Promise<EnqueueResult> {
  const milestone = milestoneFor(next.status);
  if (!milestone) return { status: "no-op", reason: "status has no email" };

  // No status change → nothing to do. The first webhook for a new card
  // (prev === null) IS treated as a transition - that's what triggers
  // the booking-confirmed email on the initial Won entry.
  const prevStatus = prev?.status;
  if (prevStatus === next.status) {
    return { status: "no-op", reason: "no status change" };
  }

  // Don't send on backwards transitions.
  if (prevStatus && STATUS_RANK[next.status] < STATUS_RANK[prevStatus]) {
    return { status: "no-op", reason: "backwards transition" };
  }

  // Defensive: existing stored records (written before this field
  // existed) deserialise without `clientEmails`. Treat undefined as
  // empty and skip with a friendly log; the next webhook event will
  // pick up the new value.
  const recipients = next.clientEmails ?? [];
  if (!recipients.length) {
    console.warn(
      `[email] no clientEmails on ${next.shootNumber} (${next.cardId}); skipping ${milestone} send`,
    );
    await markSkipped(next.cardId, milestone, "no client email on Trello card");
    return { status: "skipped", milestone, reason: "no client email" };
  }

  // Atomic claim - if another worker already started this send, bail.
  const won = await claim(next.cardId, milestone);
  if (!won) {
    return { status: "no-op", milestone, reason: "already claimed" };
  }

  const ctx = {
    statusPageUrl: `${publicBaseUrl()}/${next.slug}`,
    feedbackUrl: `${publicBaseUrl()}/feedback/${next.slug}`,
    // Greeting uses the personal contact name from Trello (e.g. "Andy")
    // not the business name. Falls back to empty string -> template
    // renders "Hi there,".
    clientFirstName: firstNameFrom(next.clientContactName),
  };

  const rendered = await renderForMilestone(milestone, next, ctx);
  if (!rendered) {
    await markSkipped(next.cardId, milestone, "no template");
    return { status: "skipped", milestone, reason: "no template" };
  }

  // Send with one retry on retriable errors. Anything more than that
  // and we're masking a real problem - mark error and let the next
  // webhook event try again.
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
        { name: "card", value: next.cardId },
      ],
    });
    if (res.ok) {
      await markSent(next.cardId, milestone, {
        messageId: res.messageId,
        recipients: recipients,
      });
      console.log(
        `[email] sent ${milestone} for ${next.shootNumber} to ${recipients.join(",")} messageId=${res.messageId}${res.dryRun ? " (dry-run)" : ""}`,
      );
      return {
        status: "sent",
        milestone,
        recipients: recipients,
        messageId: res.messageId,
      };
    }
    lastError = res.error;
    if (!res.retriable) break;
    attempt++;
    await new Promise((r) => setTimeout(r, 1500));
  }

  await markError(next.cardId, milestone, lastError);
  console.error(
    `[email] FAILED ${milestone} for ${next.shootNumber}: ${lastError}`,
  );
  return { status: "error", milestone, reason: lastError };
}
