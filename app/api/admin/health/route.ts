// GET /api/admin/health
//
// Verifies that every list on the Crew Delivery Trello board has a
// corresponding entry in lib/list-mapping.ts. Catches the failure mode
// where a list is renamed on Trello (e.g. "Assets Shared With Client" →
// "Edited Assets Shared With Client") and the mapping silently goes
// stale: every webhook event for cards in the renamed list then deletes
// the storage record and 404s the public page.
//
// Behaviour:
//   • All lists mapped (or empty + unmapped):  HTTP 200, { ok: true }
//   • Unmapped list with ≥1 OPEN card in it:    HTTP 500, { ok: false }
//     + Slack alert via SLACK_FEEDBACK_WEBHOOK_URL (if set) so it
//       surfaces in the same channel ops already watches.
//
// Auth: Bearer CRON_SECRET. Vercel cron sends this header automatically;
// manual hits also need it. Read-only, but keeping the board's list
// shape private avoids leaking internal workflow names.
//
// Schedule: see vercel.json - runs daily at 09:00 UTC. Daily is enough
// because the harm appears the next time a webhook fires for an
// affected card, not instantly.

import { NextResponse, type NextRequest } from "next/server";
import { getBoardCards, getBoardLists } from "@/lib/trello";
import { mapList } from "@/lib/list-mapping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lists we intentionally don't expose publicly. Showing them in the
// "unmapped" warning is just noise.
const IGNORED_LIST_NAMES = new Set([
  "templates",
  "backlog",
  "inbox",
]);

export async function GET(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  // CRON_SECRET is what Vercel cron sends automatically.
  // ADMIN_RESYNC_TOKEN exists as an alt-auth slot because CRON_SECRET is
  // marked sensitive in Vercel and can't be pulled to disk - the alt
  // token lets an operator run the check from their laptop after a
  // suspected board rename without redeploying. Set it via
  // `vercel env add ADMIN_RESYNC_TOKEN production --sensitive`, run the
  // check, then `vercel env rm`. Same pattern as /api/admin/resync-card.
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_RESYNC_TOKEN;
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (adminToken && auth === `Bearer ${adminToken}`);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const boardId = process.env.TRELLO_BOARD_ID;
  if (!boardId) {
    return NextResponse.json(
      { ok: false, error: "TRELLO_BOARD_ID unset" },
      { status: 500 },
    );
  }

  const [lists, cards] = await Promise.all([
    getBoardLists(boardId),
    getBoardCards(boardId),
  ]);

  const openLists = lists.filter((l) => !l.closed);
  const openCards = cards.filter((c) => !c.closed);

  type UnmappedList = {
    id: string;
    name: string;
    cardCount: number;
    sampleCardNames: string[];
  };

  const unmapped: UnmappedList[] = [];
  let mappedCount = 0;

  for (const list of openLists) {
    if (IGNORED_LIST_NAMES.has(list.name.trim().toLowerCase())) continue;
    if (mapList(list.name)) {
      mappedCount++;
      continue;
    }
    const inList = openCards.filter((c) => c.idList === list.id);
    unmapped.push({
      id: list.id,
      name: list.name,
      cardCount: inList.length,
      sampleCardNames: inList.slice(0, 5).map((c) => c.name),
    });
  }

  // Severity gate: a list with no cards is informational (we should fix
  // the mapping eventually, but nothing is currently broken). A list
  // with cards is urgent - every webhook for those cards is silently
  // deleting their storage records.
  const hasUrgent = unmapped.some((u) => u.cardCount > 0);

  if (hasUrgent) {
    // Best-effort Slack alert - failure shouldn't change the HTTP
    // response, which the cron monitors separately.
    void postUnmappedAlert(unmapped.filter((u) => u.cardCount > 0)).catch(
      (err) => {
        console.warn(
          "[health] slack alert failed:",
          (err as Error).message,
        );
      },
    );
  }

  const body = {
    ok: !hasUrgent,
    checkedAt: new Date().toISOString(),
    lists: {
      total: openLists.length,
      mapped: mappedCount,
      ignored: openLists.filter((l) =>
        IGNORED_LIST_NAMES.has(l.name.trim().toLowerCase()),
      ).length,
      unmapped,
    },
  };

  return NextResponse.json(body, { status: hasUrgent ? 500 : 200 });
}

async function postUnmappedAlert(
  urgent: { name: string; cardCount: number; sampleCardNames: string[] }[],
): Promise<void> {
  const url = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!url) {
    console.warn(
      "[health] SLACK_FEEDBACK_WEBHOOK_URL unset - logging only",
    );
    console.error(
      "[health] urgent: unmapped Trello lists with cards:",
      JSON.stringify(urgent),
    );
    return;
  }

  const heading =
    ":warning: *Crew Delivery board has unmapped Trello lists with cards in them.*";
  const detail = urgent
    .map((u) => {
      const sample = u.sampleCardNames.slice(0, 3).join(", ");
      return `• *${u.name}* - ${u.cardCount} card${u.cardCount === 1 ? "" : "s"}${
        sample ? ` (e.g. ${sample})` : ""
      }`;
    })
    .join("\n");
  const footer =
    "Add the list name (lowercased) to `lib/list-mapping.ts`. Until then, every webhook for these cards deletes them from storage and 404s the public page.";

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${heading}\n${detail}\n${footer}`,
    }),
  });
}
