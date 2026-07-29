import { test } from "node:test";
import assert from "node:assert/strict";
import { canSkipUnchanged } from "./sync-skip";

const T1 = "2026-07-29T10:00:00.000Z";
const T2 = "2026-07-29T11:00:00.000Z";

test("skips a shoot whose feed timestamp matches what we hold", () => {
  assert.equal(
    canSkipUnchanged({ fullPass: false, existingUpdatedAt: T1, feedUpdatedAt: T1 }),
    true,
  );
});

test("writes when the feed timestamp has moved", () => {
  assert.equal(
    canSkipUnchanged({ fullPass: false, existingUpdatedAt: T1, feedUpdatedAt: T2 }),
    false,
  );
});

test("never skips a shoot we don't hold yet", () => {
  // A brand-new shoot has no local copy - skipping it would mean its client
  // page never appears at all.
  assert.equal(
    canSkipUnchanged({ fullPass: false, existingUpdatedAt: null, feedUpdatedAt: T1 }),
    false,
  );
});

test("never skips when the feed gives no timestamp", () => {
  assert.equal(
    canSkipUnchanged({ fullPass: false, existingUpdatedAt: T1, feedUpdatedAt: null }),
    false,
  );
});

test("writes everything on a full pass, matching timestamps included", () => {
  // The full pass is what catches crew photo/bio/roster changes, which don't
  // move shoots.updated_at at all.
  assert.equal(
    canSkipUnchanged({ fullPass: true, existingUpdatedAt: T1, feedUpdatedAt: T1 }),
    false,
  );
});
