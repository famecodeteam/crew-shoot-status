// Client-facing timeline. 5 steps when Fame is doing post-production
// (card has the "Post Production" label), 4 steps otherwise - a crew-only
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
  | "on-hold"; // On Hold - special-cased UI

// "currentStepIndex" = the step we're NEXT working toward (highlighted in
// pink). Steps with index < returned value are ticked. Reaching a milestone
// (e.g. "crew confirmed") immediately ticks that step and advances the
// highlight to the next one - so a client whose status reads "Crew confirmed
// - meet Tom" sees both Booking confirmed and Crew confirmed ticked, and
// Shoot day highlighted as the next thing happening.
//
// Returning steps.length means "all done" (no step gets the current ring;
// every step is ticked).
const STEP_INDEX_WITH_PP: Record<ShootStatus, number> = {
  "booking-confirmed": 1, // booking done - working on crew
  "searching-for-crew": 1, // working on crew
  "crew-confirmed": 2, // crew done - working toward shoot day
  "ready-for-shoot": 2, // shoot day approaching, hasn't happened yet
  "shoot-complete": 3, // shoot done - going into editing
  "in-editing": 3, // editing in progress
  "assets-ready": 4, // editing done - awaiting client review / approval
  delivered: 5, // everything done (5 = past-the-end of a 5-step timeline)
  "on-hold": 0, // timeline hidden anyway; this value is not displayed
};

// 4-step variant: skip "In editing" entirely for crew-only engagements.
// in-editing shouldn't occur for non-PP shoots in normal workflow, but if
// it does (PM error), treat it as shoot-complete.
const STEP_INDEX_NO_PP: Record<ShootStatus, number> = {
  "booking-confirmed": 1,
  "searching-for-crew": 1,
  "crew-confirmed": 2,
  "ready-for-shoot": 2,
  "shoot-complete": 3, // working toward delivery
  "in-editing": 3, // anomaly for non-PP - treat same as shoot-complete
  "assets-ready": 3, // working toward final delivery
  delivered: 4, // everything done (past-the-end of 4-step timeline)
  "on-hold": 0,
};

export function currentStepIndex(status: ShootStatus, hasPostProduction: boolean): number {
  return (hasPostProduction ? STEP_INDEX_WITH_PP : STEP_INDEX_NO_PP)[status];
}
