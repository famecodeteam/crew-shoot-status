// Trello list name → internal ShootStatus → client-facing label.
// Brief §"Status mapping" is the source of truth here.

import type { ShootStatus } from "../app/[slug]/status";

type Mapping = {
  status: ShootStatus;
  // Whether the page should be visible at all. Pre-"Won" cards (Lead, etc.)
  // shouldn't render a public page even if the URL is guessed.
  publishable: boolean;
  // Whether the timeline is visually meaningful. On-hold pages skip the
  // timeline in favour of the special on-hold notice.
  showTimeline: boolean;
};

// Lowercased list names for case-insensitive matching. Anything not in
// this map is treated as not-publishable (the page 404s).
const LISTS: Record<string, Mapping> = {
  won: { status: "booking-confirmed", publishable: true, showTimeline: true },
  "searching for crew": {
    status: "searching-for-crew",
    publishable: true,
    showTimeline: true,
  },
  "crew booked": { status: "crew-confirmed", publishable: true, showTimeline: true },
  "ready for shoot": { status: "ready-for-shoot", publishable: true, showTimeline: true },
  "shoot complete": { status: "shoot-complete", publishable: true, showTimeline: true },
  "assets received from crew": {
    status: "in-editing",
    publishable: true,
    showTimeline: true,
  },
  // Live board has the misspelling "Recieved" - match both so a future
  // typo-fix on Trello doesn't break this mapping.
  "assets recieved from crew": {
    status: "in-editing",
    publishable: true,
    showTimeline: true,
  },
  "assets in production": {
    status: "in-editing",
    publishable: true,
    showTimeline: true,
  },
  "assets shared with client": {
    status: "assets-ready",
    publishable: true,
    showTimeline: true,
  },
  "assets approved by client": {
    status: "delivered",
    publishable: true,
    showTimeline: true,
  },
  // CRITICAL: "Awaiting Payment" is internal-only. Externally we say
  // "Delivered ✓" - never leak this list name to clients.
  "awaiting payment": { status: "delivered", publishable: true, showTimeline: true },
  closed: { status: "delivered", publishable: true, showTimeline: true },
  "on hold": { status: "on-hold", publishable: true, showTimeline: false },
};

export function mapList(listName: string): Mapping | null {
  const key = listName.trim().toLowerCase();
  return LISTS[key] ?? null;
}

// Client-facing label for the hero badge. Most labels are stable; "crew-confirmed"
// gets the crew member's first name interpolated when known.
export function statusLabel(status: ShootStatus, crewFirstName?: string): string {
  switch (status) {
    case "booking-confirmed":
      return "Booking confirmed";
    case "searching-for-crew":
      return "Confirming your crew";
    case "crew-confirmed":
      return crewFirstName ? `Crew confirmed - meet ${crewFirstName}` : "Crew confirmed";
    case "ready-for-shoot":
      return "Ready for shoot";
    case "shoot-complete":
      return "Footage captured";
    case "in-editing":
      return "In editing";
    case "assets-ready":
      return "Assets ready for review";
    case "delivered":
      return "Delivered ✓";
    case "on-hold":
      return "On hold";
  }
}
