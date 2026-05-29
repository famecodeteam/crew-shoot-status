// Manual live milestone send. For one-off ops sends that bypass the
// normal webhook + 15-min buffer flow - e.g. a card that moved
// backward into a milestone list (so the automated send no-op'd) but
// the client genuinely should get the email.
//
// Unlike /api/admin/email-preview (which only ever sends to the
// dryrun inbox), THIS endpoint sends to the REAL client emails on the
// card. It is therefore gated on a dedicated bearer secret
// (ADMIN_SEND_SECRET) so it can't be triggered casually.
//
// Reuses dispatchPendingEmail from the cron path: same render, same
// recipient resolution, same idempotency claim, same mark-sent. We
// pass the shoot's CURRENT status as the expected status so the
// cron's "did the card move on" guard is a no-op here (this is a
// deliberate manual send, not a buffered one). After a successful
// send we post the same "📧 Email sent" comment on the Trello card
// the cron posts.
//
// POST body: { "cardId": "<trello card id>", "milestone": "<milestone>" }

import { NextResponse, type NextRequest } from "next/server";
import { getByCardId } from "@/lib/storage";
import { addCardComment } from "@/lib/trello";
import {
  dispatchPendingEmail,
  subjectForMilestone,
} from "@/lib/emails/enqueue";
import type { EmailMilestone } from "@/lib/email-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MILESTONES: EmailMilestone[] = [
  "booking-confirmed",
  "crew-confirmed",
  "ready-for-shoot",
  "footage-in",
  "assets-ready",
  "delivered",
];

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SEND_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { cardId?: string; milestone?: string };
  try {
    body = (await req.json()) as { cardId?: string; milestone?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { cardId } = body;
  const milestone = body.milestone as EmailMilestone | undefined;
  if (!cardId || !milestone) {
    return NextResponse.json(
      { error: "missing cardId or milestone" },
      { status: 400 },
    );
  }
  if (!VALID_MILESTONES.includes(milestone)) {
    return NextResponse.json(
      { error: `invalid milestone: ${milestone}`, valid: VALID_MILESTONES },
      { status: 400 },
    );
  }

  const shoot = await getByCardId(cardId);
  if (!shoot) {
    return NextResponse.json(
      { error: `no shoot found for cardId: ${cardId}` },
      { status: 404 },
    );
  }

  // Pass the live status as the expected status so dispatch's
  // status-moved guard is a no-op - this is a deliberate manual send.
  const result = await dispatchPendingEmail(shoot, milestone, shoot.status);

  if (result.status === "sent") {
    try {
      const subject = subjectForMilestone(milestone, shoot);
      await addCardComment(
        cardId,
        `📧 Email sent (manual): ${subject}\nRecipients: ${(result.recipients ?? []).join(", ")}`,
      );
    } catch (err) {
      console.warn(
        `[admin/send-milestone] Trello comment failed for ${shoot.shootNumber}:`,
        (err as Error).message,
      );
    }
  }

  return NextResponse.json({
    shoot: {
      shootNumber: shoot.shootNumber,
      clientName: shoot.clientName,
      slug: shoot.slug,
      status: shoot.status,
      hasPostProduction: shoot.hasPostProduction,
      clientEmails: shoot.clientEmails ?? [],
    },
    milestone,
    result,
  });
}
