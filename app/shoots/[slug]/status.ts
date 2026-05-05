// Client-facing timeline. 5 steps when Fame is doing post-production
// (card has the "Post Production" label), 4 steps otherwise — a crew-only
// engagement skips "In editing" because the client edits in-house.
export const TIMELINE_STEPS_WITH_PP = [
  "Booking confirmed",
  "Crew confirmed",
  "Shoot day",
  "In editing",
  "Delivered",
] as const;

export const TIMELINE_STEPS_NO_PP = [
  "Booking confirmed",
  "Crew confirmed",
  "Shoot day",
  "Delivered",
] as const;

export function timelineSteps(hasPostProduction: boolean): readonly string[] {
  return hasPostProduction ? TIMELINE_STEPS_WITH_PP : TIMELINE_STEPS_NO_PP;
}

// Internal status keys we persist after Trello list → status mapping.
// Kept compact and stable so the JSON blob is small.
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

const STEP_INDEX_WITH_PP: Record<ShootStatus, number> = {
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

// 4-step variant: "In editing" is collapsed — assets-ready and delivered
// land on the final "Delivered" step. in-editing shouldn't occur for a
// non-PP shoot in normal workflow (those cards don't go through the
// editing lists), but if it does, we keep them at "Shoot day" until a
// genuinely-delivered list catches them.
const STEP_INDEX_NO_PP: Record<ShootStatus, number> = {
  "booking-confirmed": 0,
  "searching-for-crew": 0,
  "crew-confirmed": 1,
  "ready-for-shoot": 2,
  "shoot-complete": 2,
  "in-editing": 2,
  "assets-ready": 3,
  delivered: 3,
  "on-hold": 0,
};

export function currentStepIndex(status: ShootStatus, hasPostProduction: boolean): number {
  return (hasPostProduction ? STEP_INDEX_WITH_PP : STEP_INDEX_NO_PP)[status];
}
