import type { ShootStatus } from "../app/[slug]/status";
import type { MilestoneDates } from "./milestone-dates";

// Options on the Trello "Crew Status" single-select list field. Crew tap
// these via member.fame.so; the client page reads them via the same
// Trello card the rest of the pipeline reads from.
export type CrewStatus =
  | "Confirmed"
  | "On the way"
  | "On site"
  | "Wrapping"
  | "Wrapped";

// Public data model — what /[slug] reads. One blob per Trello card.
export type Shoot = {
  slug: string;
  cardId: string; // Trello card id (stable across renames)
  shootNumber: string; // "#0190"
  clientName: string; // "genOway"
  // Category-style label from Trello (e.g. "Podcast", "Conference",
  // "Event"). Sourced from the card's first non-"Post Production" label.
  shootType?: string;
  location: string;
  shootDate: string; // ISO YYYY-MM-DD or ""
  status: ShootStatus;
  statusLabel: string; // client-facing label (already mapped from Trello list)
  crew?: {
    name: string;
    bio: string;
    photoUrl?: string;
  };
  briefUrl?: string;
  quoteUrl?: string;
  finalAssetsUrl?: string;
  depositReceiptUrl?: string;
  balanceReceiptUrl?: string;
  // WhatsApp group invite URL shared with the client — set on the
  // Trello card so it can be surfaced as "where comms happens" during
  // shoot week.
  clientWhatsappUrl?: string;
  producerEmail: string;
  // Whether Fame is doing post-production. Drives whether the timeline
  // includes the "In editing" step. Source: "Post Production" Trello label.
  hasPostProduction: boolean;
  // Live crew status set via the "Crew Status" list custom field on the
  // Trello card (M7 feed-through from the separate crew page at
  // member.fame.so). One of: "Confirmed" | "On the way" | "On site" |
  // "Wrapping" | "Wrapped" | undefined when unset.
  crewStatus?: CrewStatus;
  // Dates each milestone was reached, derived from Trello action history.
  // Missing entries = not yet reached (or card skipped that list).
  milestoneDates: MilestoneDates;
  // Projected Delivered date (Shoot day + 5 business days for PP shoots,
  // +1 calendar day for crew-only). Only used when delivered hasn't been
  // reached yet — the UI prefers the actual milestoneDates.delivered.
  projectedDeliveredDate?: string; // YYYY-MM-DD
  // Bookkeeping
  trelloListId: string;
  trelloListName: string;
  updatedAt: string; // ISO timestamp of last write
};
