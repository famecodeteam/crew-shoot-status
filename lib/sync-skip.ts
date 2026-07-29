// Whether an incremental sync run can leave a shoot untouched.
//
// Pure and tested separately because getting it wrong is expensive in a way
// that's invisible: a shoot wrongly skipped just stops updating on the
// client's page, with nothing in the summary to say why. That is the exact
// failure the incremental pass exists to avoid causing.

export function canSkipUnchanged(opts: {
  fullPass: boolean;
  /** The copy we already hold, if any. */
  existingUpdatedAt: string | null | undefined;
  /** What the feed says now. */
  feedUpdatedAt: string | null | undefined;
}): boolean {
  const { fullPass, existingUpdatedAt, feedUpdatedAt } = opts;
  // The hourly reconcile always writes - it's what catches changes that don't
  // move shoots.updated_at (crew photo, bio, roster).
  if (fullPass) return false;
  // Never skip a shoot we don't hold yet, however old its timestamp.
  if (!existingUpdatedAt) return false;
  // No timestamp from the feed means we can't prove it's unchanged.
  if (!feedUpdatedAt) return false;
  return existingUpdatedAt === feedUpdatedAt;
}
