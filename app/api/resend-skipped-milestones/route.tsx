// POST /api/resend-skipped-milestones   { "cardId": "<trello card id>" }
//
// Self-heal for the "client email added after the milestone fired" gap.
//
// Milestone emails fire on the Trello list move into a status. If the card
// has no client email at that moment, the send is recorded as "skipped"
// ("no client email on Trello card") and never retried - so adding the email
// later silently does nothing (e.g. #0237 Comtech: booking-confirmed skipped
// at the Won move, email added afterwards, never sent).
//
// member.fame.so calls this whenever a client email is set on a shoot. We
// refresh the card from the feed (so the just-added email is present), then
// re-send any milestone whose tracker status is "skipped" - which can only
// happen for a status the shoot genuinely moved into, so re-sending is always
// in-context. dispatchPendingEmail handles recipient resolution, the
// idempotency claim, and mark-sent, and we pass the live status so its
// "did the card move on" guard is a no-op. Already-sent milestones are
// untouched, so this is safe to call on every client-email edit.
//
// Auth: SYNC_API_SECRET (the shared member.fame.so <-> shoots.fame.so secret).

import { NextResponse, type NextRequest } from "next/server";
import { getByCardId } from "@/lib/storage";
import { refreshOneFromFeed } from "@/lib/sync-from-feed";
import { dispatchPendingEmail, subjectForMilestone } from "@/lib/emails/enqueue";
import { get as getSent, type EmailMilestone } from "@/lib/email-tracker";
import { addCardComment } from "@/lib/trello";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MILESTONES: EmailMilestone[] = [
  "booking-confirmed",
  "crew-confirmed",
  "ready-for-shoot",
  "footage-in",
  "assets-ready",
  "delivered",
];

function authed(req: NextRequest): boolean {
  const secret = process.env.SYNC_API_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  return !!secret && auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { cardId?: string };
  try {
    body = (await req.json()) as { cardId?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const cardId = body.cardId?.trim();
  if (!cardId) {
    return NextResponse.json({ error: "missing cardId" }, { status: 400 });
  }

  // Refresh from the feed so the just-added client email is reflected.
  const shoot = (await refreshOneFromFeed(cardId)) ?? (await getByCardId(cardId));
  if (!shoot) {
    return NextResponse.json(
      { error: `no shoot for cardId: ${cardId}` },
      { status: 404 },
    );
  }
  const recipients = shoot.clientEmails ?? [];
  if (recipients.length === 0) {
    return NextResponse.json({ resent: [], reason: "no client email on file" });
  }

  const resent: Array<{ milestone: EmailMilestone; status: string }> = [];
  for (const milestone of MILESTONES) {
    const sent = await getSent(cardId, milestone);
    // Only re-send milestones that were SKIPPED. A "skipped" record only
    // exists for a status the shoot actually moved into, so re-sending is
    // always in-context. Never-fired (null) and already-sent are left alone.
    if (sent?.status !== "skipped") continue;
    // Live status as the expected status -> dispatch's move-guard is a no-op.
    const result = await dispatchPendingEmail(shoot, milestone, shoot.status);
    resent.push({ milestone, status: result.status });
    if (result.status === "sent") {
      try {
        await addCardComment(
          cardId,
          `📧 Email sent (auto-resend after client email added): ${subjectForMilestone(
            milestone,
            shoot,
          )}\nRecipients: ${(result.recipients ?? []).join(", ")}`,
        );
      } catch {
        // best-effort Trello comment
      }
    }
  }

  return NextResponse.json({
    cardId,
    status: shoot.status,
    clientEmails: recipients,
    resent,
  });
}
