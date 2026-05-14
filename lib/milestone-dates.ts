// Derive milestone dates from Trello card-action history + project the
// Delivered ETA from the Shoot Date when delivery hasn't happened yet.
//
// Past dates: actual moment each list-move happened. If a card skipped
// a milestone list (rare but possible), that milestone shows no date -
// we don't fabricate past dates we don't have evidence for.
//
// Future delivered date is a turnaround heuristic:
//   - Post-production shoot → Shoot day + 5 business days
//   - Crew-only shoot (no Post Production label) → Shoot day + 1 calendar day

import type { TrelloAction } from "./trello";
import type { ShootStatus } from "../app/[slug]/status";

export type MilestoneDates = {
  bookingConfirmed?: string; // ISO timestamp
  crewConfirmed?: string;
  inEditing?: string;
  delivered?: string;
};

// Lowercased Trello list name → which milestone it satisfies.
// (List name spellings here mirror the canonical mapping in list-mapping.ts,
// including the live board's "Recieved" typo.)
//
// "Assets Shared With Client" deliberately maps to NOTHING. Sharing
// assets for review is not the same as delivery — the client-facing
// label for that list is "Assets ready for review", not "Delivered".
// Treating it as `delivered` was a bug: it baked an actual delivered
// date into the record, which short-circuits the projected-ETA path
// and stops the "Post Prod Turnaround" override from ever applying.
// The genuine `delivered` milestone is only the post-approval lists.
const LIST_TO_MILESTONE: Record<string, keyof MilestoneDates> = {
  won: "bookingConfirmed",
  "crew booked": "crewConfirmed",
  "assets received from crew": "inEditing",
  "assets recieved from crew": "inEditing",
  "assets in production": "inEditing",
  "assets approved by client": "delivered",
  "awaiting payment": "delivered",
  closed: "delivered",
};

// Walk the card's action history chronologically; record the FIRST time
// each milestone was reached.
export function deriveMilestoneDates(actions: TrelloAction[]): MilestoneDates {
  const chronological = actions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const out: MilestoneDates = {};
  for (const action of chronological) {
    let listName: string | undefined;
    if (action.type === "createCard") {
      listName = action.data?.list?.name?.toLowerCase();
    } else if (action.type === "updateCard") {
      listName = action.data?.listAfter?.name?.toLowerCase();
    }
    if (!listName) continue;
    const milestone = LIST_TO_MILESTONE[listName];
    if (!milestone) continue;
    if (!out[milestone]) out[milestone] = action.date;
  }
  return out;
}

// Linear pipeline rank for a status - higher = further along the
// Won → ... → Delivered flow.
const STATUS_RANK: Record<ShootStatus, number> = {
  "booking-confirmed": 1,
  "searching-for-crew": 2,
  "crew-confirmed": 3,
  "ready-for-shoot": 4,
  "shoot-complete": 5,
  "in-editing": 6,
  "assets-ready": 7,
  delivered: 8,
  "on-hold": 0, // timeline hidden anyway; see early-return below
};

// Which status each milestone represents "having reached".
const MILESTONE_STATUS: Record<keyof MilestoneDates, ShootStatus> = {
  bookingConfirmed: "booking-confirmed",
  crewConfirmed: "crew-confirmed",
  inEditing: "in-editing",
  delivered: "delivered",
};

// Drop any milestone date that sits AHEAD of where the card actually is
// now. deriveMilestoneDates records the FIRST time a list was touched,
// which goes stale when a card moves BACKWARD - e.g. a PM drags a card
// into "Assets Approved By Client" by mistake and then back to editing.
// The forward move stays in the action history forever, so the card
// keeps a "delivered" date it no longer warrants (and that date also
// short-circuits the projected-ETA path). Capping to the current status
// keeps milestone dates consistent with the timeline's own tick/highlight
// state, which is already current-status-driven (see currentStepIndex).
export function capMilestonesToStatus(
  milestones: MilestoneDates,
  status: ShootStatus,
): MilestoneDates {
  // on-hold: timeline is hidden and the card's real pipeline position is
  // unknown - leave the derived dates untouched.
  if (status === "on-hold") return milestones;
  const rank = STATUS_RANK[status];
  const out: MilestoneDates = {};
  for (const key of Object.keys(milestones) as (keyof MilestoneDates)[]) {
    if (rank >= STATUS_RANK[MILESTONE_STATUS[key]]) {
      out[key] = milestones[key];
    }
  }
  return out;
}

// Project the Delivered date for shoots that haven't been delivered yet.
// shootDate is "YYYY-MM-DD"; returns same shape.
//
// turnaroundOverride: per-shoot override from the "Post Prod Turnaround"
// custom field. When set:
//   - PP shoot     → override is in BUSINESS days
//   - Crew-only    → override is in CALENDAR days
// When unset, the defaults are 5 business / 1 calendar respectively.
export function projectDeliveredDate(
  shootDate: string,
  hasPostProduction: boolean,
  turnaroundOverride?: number,
): string | undefined {
  if (!shootDate) return undefined;
  const d = new Date(shootDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return undefined;

  if (hasPostProduction) {
    const days = turnaroundOverride && turnaroundOverride > 0 ? turnaroundOverride : 5;
    let added = 0;
    while (added < days) {
      d.setUTCDate(d.getUTCDate() + 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) added++;
    }
  } else {
    const days = turnaroundOverride && turnaroundOverride > 0 ? turnaroundOverride : 1;
    d.setUTCDate(d.getUTCDate() + days);
  }
  return d.toISOString().slice(0, 10);
}
