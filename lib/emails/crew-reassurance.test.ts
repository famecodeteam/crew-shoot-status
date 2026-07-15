import { test } from "node:test";
import assert from "node:assert/strict";
import { crewReassuranceDecision } from "./enqueue";
import type { Shoot } from "../types";

const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 86_400_000).toISOString();

function shoot(p: Partial<Shoot>): Shoot {
  return {
    status: "booking-confirmed",
    slug: "0300-acme-abc12345",
    shootDate: iso(20).slice(0, 10),
    clientEmails: ["client@acme.com"],
    milestoneDates: { bookingConfirmed: iso(-3) },
    ...p,
  } as Shoot;
}

test("sends 3 days after deposit when crew still not secured", () => {
  const d = crewReassuranceDecision(shoot({}));
  assert.equal(d.send, true);
});

test("does NOT send before 3 days after deposit", () => {
  const d = crewReassuranceDecision(shoot({ milestoneDates: { bookingConfirmed: iso(-1) } }));
  assert.equal(d.send, false);
});

test("does NOT send once crew is confirmed", () => {
  const d = crewReassuranceDecision(shoot({ status: "crew-confirmed" as Shoot["status"] }));
  assert.equal(d.send, false);
});

test("does NOT send when there's no booking/deposit date", () => {
  const d = crewReassuranceDecision(shoot({ milestoneDates: {} }));
  assert.equal(d.send, false);
});

test("does NOT send for a shoot that already happened", () => {
  const d = crewReassuranceDecision(shoot({ shootDate: iso(-1).slice(0, 10) }));
  assert.equal(d.send, false);
});

test("still sends for a far-future shoot (deposit-based, not shoot-proximity)", () => {
  const d = crewReassuranceDecision(shoot({ shootDate: iso(90).slice(0, 10) }));
  assert.equal(d.send, true);
});
