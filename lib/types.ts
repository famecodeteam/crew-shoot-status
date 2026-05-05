import type { ShootStatus } from "../app/shoots/[slug]/status";

// Public data model — what /shoots/[slug] reads. One blob per Trello card.
export type Shoot = {
  slug: string;
  cardId: string; // Trello card id (stable across renames)
  shootNumber: string; // "#0190"
  clientName: string; // "genOway"
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
  producerEmail: string;
  // Bookkeeping
  trelloListId: string;
  trelloListName: string;
  updatedAt: string; // ISO timestamp of last write
};
