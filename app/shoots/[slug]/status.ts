// 5 client-facing timeline steps. Sub-states map onto these.
export const TIMELINE_STEPS = [
  "Booking confirmed",
  "Crew confirmed",
  "Shoot day",
  "In editing",
  "Delivered",
] as const;

// Internal status keys we'll persist after Trello list → status mapping (M2).
// Kept compact and stable so the JSON blob in KV is small.
export type ShootStatus =
  | "booking-confirmed" // Won
  | "searching-for-crew" // Searching For Crew (still step 0 client-side)
  | "crew-confirmed" // Crew Booked
  | "ready-for-shoot" // Ready For Shoot
  | "shoot-complete" // Shoot Complete (still step 2 client-side until edit starts)
  | "in-editing" // Assets Received From Crew + Assets In Production
  | "assets-ready" // Assets Shared With Client
  | "delivered" // Approved + Awaiting Payment + Closed (DO NOT leak Awaiting Payment)
  | "on-hold"; // On Hold — special-cased UI

const STEP_INDEX: Record<ShootStatus, number> = {
  "booking-confirmed": 0,
  "searching-for-crew": 0,
  "crew-confirmed": 1,
  "ready-for-shoot": 2,
  "shoot-complete": 2,
  "in-editing": 3,
  "assets-ready": 4,
  delivered: 4,
  "on-hold": 0,
};

export function currentStepIndex(status: ShootStatus): number {
  return STEP_INDEX[status];
}
