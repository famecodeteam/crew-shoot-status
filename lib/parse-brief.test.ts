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

// Brief #0214 uses a different producer template than #0219 — it tests
// the colon-outside-bold pattern, internal colons in labels (time
// ranges), and section 3 with no explicit Confirmed Schedule /
// Equipment / Deliverables subheadings (everything bullet-ranges into
// the deliverables fallback).
const FIXTURE_0214 = path.join(__dirname, "__fixtures__", "brief-0214.json");
const fixture0214 = JSON.parse(
  readFileSync(FIXTURE_0214, "utf8"),
) as docs_v1.Schema$Document;

test("parseBriefDoc: Brief #0214 (TikTok)", async (t) => {
  const result = parseBriefDoc(fixture0214);

  await t.test("header parses non-Demand-AI template", () => {
    assert.equal(result.header.briefNumber, "0214");
    assert.equal(result.header.clientName, "TikTok");
    assert.match(result.header.eventName, /LA Events/);
  });

  await t.test("overview keeps internal colons in time-range labels", () => {
    const s = result.sections.find((x) => x.kind === "overview");
    assert.ok(s && s.kind === "overview");
    if (!s || s.kind !== "overview") return;
    // Labels containing colons (time ranges) must survive splitLabelValue.
    assert.ok("Monday 11th (10:00–11:30 am)" in s.fields);
    assert.match(
      String(s.fields["Monday 11th (10:00–11:30 am)"]),
      /TikTok LA HQ/,
    );
  });

  await t.test("colon-outside-bold pattern parses correctly", () => {
    // Section 3 in #0214 is bullets like "**On-Site Coverage**: 4 hours…"
    // — bold prefix WITHOUT the trailing colon. Should still produce
    // deliverables (the default bucket when no explicit subheading is
    // detected).
    const s = result.sections.find((x) => x.kind === "production");
    assert.ok(s && s.kind === "production");
    if (!s || s.kind !== "production") return;
    assert.equal(s.schedule.length, 0);
    assert.ok(s.deliverables.length > 0);
    // The "On-Site Coverage" line should render with its bold lead.
    const blob = s.deliverables.map((b) => b.html).join("\n");
    assert.match(blob, /<strong>On-Site Coverage<\/strong>/);
  });

  await t.test("unknown section title falls through to prose", () => {
    // "5. Shoot Status" isn't in SECTION_KIND_BY_TITLE; should render
    // as the prose fallback.
    const s = result.sections.find(
      (x) => x.kind === "prose" && x.title === "Shoot Status",
    );
    assert.ok(s);
  });
});

// Brief #0203 (Rios Business Funding) — producer styled every field
// paragraph as HEADING_3. Earlier the parser split on every heading,
// produced ~18 empty sections, and the page rendered blank.
// Regression test ensures the parser is now tolerant of that drift:
// only numbered HEADING_3s create section boundaries, and field rows
// without explicit bold styling still parse via the no-bold fallback
// in splitLabelValue.
const FIXTURE_0203 = path.join(__dirname, "__fixtures__", "brief-0203.json");
const fixture0203 = JSON.parse(
  readFileSync(FIXTURE_0203, "utf8"),
) as docs_v1.Schema$Document;

test("parseBriefDoc: Brief #0203 (Rios) — all-HEADING_3 producer drift", async (t) => {
  const result = parseBriefDoc(fixture0203);

  await t.test("section count + ordering survives heading drift", () => {
    const kinds = result.sections.map((s) => s.kind);
    // Should have exactly 5 numbered sections, in order.
    assert.deepEqual(kinds, [
      "overview",
      "objectives",
      "production",
      "crew",
      "prose", // "Shooting Status" — falls to prose, filtered in render
    ]);
  });

  await t.test("overview fields populate via no-bold fallback", () => {
    const s = result.sections.find((x) => x.kind === "overview");
    assert.ok(s && s.kind === "overview");
    if (!s || s.kind !== "overview") return;
    assert.equal(s.fields["Client Name"], "Rios Business Funding");
    assert.match(String(s.fields["Primary Contact"]), /jimmy@/);
    assert.match(String(s.fields["Location"]), /Chandler/);
  });

  await t.test("crew member parses without explicit bold runs", () => {
    const s = result.sections.find((x) => x.kind === "crew");
    assert.ok(s && s.kind === "crew");
    if (!s || s.kind !== "crew") return;
    assert.equal(s.members.length, 1);
    assert.equal(s.members[0].name, "Thomas Pelletier");
  });
});
