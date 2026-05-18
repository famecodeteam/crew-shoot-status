// Parser unit test, fixtured against the real Brief #0219 (Demand AI)
// Docs API response. Asserts the rendered JSON shape — not the exact text,
// where small producer edits would cause false failures.
//
//   pnpm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { docs_v1 } from "googleapis";
import { isExcludedSection, parseBriefDoc } from "./parse-brief";

const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "brief-0219.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as docs_v1.Schema$Document;

test("parseBriefDoc: Brief #0219 (Demand AI)", async (t) => {
  const result = parseBriefDoc(fixture);

  await t.test("header", () => {
    assert.equal(result.header.briefNumber, "0219");
    assert.equal(result.header.clientName, "Demand AI");
    assert.match(result.header.eventName, /B2B Marketing/);
  });

  await t.test("excludes 'Questions for the Client Call'", () => {
    for (const s of result.sections) {
      assert.doesNotMatch(s.title, /Questions for the Client Call/i);
    }
  });

  await t.test("section order matches the template", () => {
    const kinds = result.sections.map((s) => s.kind);
    assert.deepEqual(kinds, ["overview", "objectives", "production", "crew", "comms"]);
  });

  await t.test("Section 1 — overview fields", () => {
    const s = result.sections[0];
    assert.equal(s.kind, "overview");
    if (s.kind !== "overview") return;
    assert.equal(s.fields["Client Name"], "Demand AI");
    assert.equal(s.fields["Primary Contact"], "Abigail Crosby, Media Project Manager");
    assert.match(String(s.fields["Event Name"]), /Impact of AI/);
    assert.match(String(s.fields["Location"]), /Bernam/);
    assert.match(String(s.fields["Date of Coverage"]), /May 19, 2026/);
  });

  await t.test("Section 2 — objectives contain bold leads and a hyperlink", () => {
    const s = result.sections[1];
    assert.equal(s.kind, "objectives");
    if (s.kind !== "objectives") return;
    assert.equal(s.blocks.length, 3);
    // Core Goal block has a bold lead, no link.
    assert.match(s.blocks[0].html, /<strong>Core Goal:<\/strong>/);
    // Visual Reference has a YouTube link.
    assert.match(s.blocks[1].html, /<strong>Visual Reference:<\/strong>/);
    assert.match(
      s.blocks[1].html,
      /<a href="https:\/\/www\.youtube\.com\/watch\?v=keCz51r85uQ"/,
    );
    // Tone/Vibe block has a bold lead, no link.
    assert.match(s.blocks[2].html, /<strong>Tone\/Vibe:<\/strong>/);
  });

  await t.test("Section 3 — production: schedule, equipment, deliverables", () => {
    const s = result.sections[2];
    assert.equal(s.kind, "production");
    if (s.kind !== "production") return;
    // 4 schedule rows in #0219.
    assert.equal(s.schedule.length, 4);
    assert.deepEqual(s.schedule[0], { time: "1:00 PM", what: "Crew Arrival & Room Setup" });
    assert.match(s.schedule[2].time, /2:00 PM\s*[-–—]\s*3:00 PM/);
    // Equipment keyed map.
    assert.equal(s.equipment["Cameras"], "2x 4K Camera Kits.");
    assert.match(s.equipment["Audio"], /Lapel Microphones/);
    assert.match(s.equipment["Lighting"], /Lighting kit/);
    // Deliverables prose.
    assert.equal(s.deliverables.length, 1);
    assert.match(s.deliverables[0].html, /[Rr]aw audio and video files/);
  });

  await t.test("Section 4 — crew", () => {
    const s = result.sections[3];
    assert.equal(s.kind, "crew");
    if (s.kind !== "crew") return;
    assert.equal(s.members.length, 1);
    assert.equal(s.members[0].name, "Asher Maleriado");
    assert.match(String(s.members[0].contact), /\+65 9248 0720/);
  });

  await t.test("Section 5 — comms links", () => {
    const s = result.sections[4];
    assert.equal(s.kind, "comms");
    if (s.kind !== "comms") return;
    assert.ok(s.links.length >= 1);
    const statusLink = s.links.find((l) => /shoots\.fame\.so/.test(l.url));
    assert.ok(statusLink, "expected the status-page link card");
    assert.equal(statusLink?.label, "Project Status Page");
  });
});

test("isExcludedSection: matches the v1 exclusion list", () => {
  assert.equal(isExcludedSection("6. Questions for the Client Call"), true);
  assert.equal(isExcludedSection("Questions for the Client Call"), true);
  assert.equal(isExcludedSection("questions FOR THE client call"), true);
  assert.equal(isExcludedSection("1. Project Overview"), false);
});
