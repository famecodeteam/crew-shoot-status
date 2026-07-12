// Crew-reassurance cron. Runs daily (vercel.json). Scans every shoot and,
// for any that is paid-but-not-yet-crewed with a shoot date inside the
// reassurance window, sends a one-off "your crew is being lined up" email -
// closing the silent gap between booking-confirmed and crew-confirmed where
// clients would otherwise email to chase.
//
// Time-triggered, not status-triggered: the status milestone emails fire on
// Trello list moves; this fires on proximity to shoot.shootDate, so it needs
// its own scan rather than riding the webhook. It self-cancels once crew is
// confirmed (the card leaves the pre-crew statuses) and is idempotent per
// shoot (sent-tracker claim), so a daily re-run is a safe no-op.
//
// SAFE BY DEFAULT: real client emails only go out when CREW_REASSURANCE_LIVE
// === "true". Until then the cron reports who it WOULD email ("would-send")
// without touching Postmark or the sent-tracker - so deploying can't email a
// real client before the copy is signed off. Flip the env var + redeploy to
// go live; in-window shoots get the email on the next run.
//
// Auth: CRON_SECRET bearer (Vercel cron sends it automatically).

import { NextResponse, type NextRequest } from "next/server";
import { listAll } from "@/lib/storage";
import { addCardComment } from "@/lib/trello";
import { sendCrewReassurance, subjectForMilestone } from "@/lib/emails/enqueue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Result = {
  cardId: string;
  shootSlug: string;
  status: string;
  outcome: string;
  reason?: string;
  recipients?: string[];
  messageId?: string;
};

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const live = process.env.CREW_REASSURANCE_LIVE === "true";
  const shoots = await listAll();

  const summary = {
    live,
    considered: shoots.length,
    sent: 0,
    wouldSend: 0,
    skipped: 0,
    errors: 0,
    results: [] as Result[],
  };

  for (const shoot of shoots) {
    let res;
    try {
      res = await sendCrewReassurance(shoot, { live });
    } catch (err) {
      summary.errors++;
      summary.results.push({
        cardId: shoot.cardId,
        shootSlug: shoot.slug,
        status: shoot.status,
        outcome: "error",
        reason: (err as Error).message,
      });
      continue;
    }

    // Only the interesting outcomes are worth logging - a shoot that's out of
    // window / already crewed returns no-op and would drown the summary.
    if (res.status === "no-op") continue;

    const row: Result = {
      cardId: shoot.cardId,
      shootSlug: shoot.slug,
      status: shoot.status,
      outcome: res.status,
    };

    if (res.status === "sent") {
      summary.sent++;
      row.recipients = res.recipients;
      row.messageId = res.messageId;
      // In-context record on the card, same as the milestone flush cron does.
      try {
        await addCardComment(
          shoot.cardId,
          `Email sent: ${subjectForMilestone("crew-reassurance", shoot)}`,
        );
      } catch {
        // Best-effort - a Trello hiccup must not fail the send that succeeded.
      }
    } else if (res.status === "would-send") {
      summary.wouldSend++;
      row.recipients = res.recipients;
    } else if (res.status === "skipped") {
      summary.skipped++;
      row.reason = res.reason;
    } else if (res.status === "error") {
      summary.errors++;
      row.reason = res.reason;
    }

    summary.results.push(row);
  }

  console.log(
    `[crew-reassurance] live=${live} considered=${summary.considered} sent=${summary.sent} wouldSend=${summary.wouldSend} skipped=${summary.skipped} errors=${summary.errors}`,
  );

  return NextResponse.json(summary);
}
