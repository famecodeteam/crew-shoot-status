import { test } from "node:test";
import assert from "node:assert/strict";
import { clientFacingCrewName } from "./crew-name";

test("shortens a normal name to first + surname initial", () => {
  assert.equal(clientFacingCrewName("Ekaterina Poletaeva"), "Ekaterina P");
});

test("leaves a single name alone rather than inventing an initial", () => {
  assert.equal(clientFacingCrewName("Cher"), "Cher");
});

test("uses the LAST part for the initial on multi-part surnames", () => {
  assert.equal(clientFacingCrewName("Maria de la Cruz"), "Maria C");
});

test("keeps a hyphenated first name intact", () => {
  assert.equal(clientFacingCrewName("Anne-Marie Smith"), "Anne-Marie S");
});

test("uppercases a lowercase surname initial", () => {
  assert.equal(clientFacingCrewName("jordan huffman"), "jordan H");
});

test("copes with extra whitespace", () => {
  assert.equal(clientFacingCrewName("  Matt   Silveria  "), "Matt S");
});

test("returns empty for missing input", () => {
  assert.equal(clientFacingCrewName(null), "");
  assert.equal(clientFacingCrewName(undefined), "");
  assert.equal(clientFacingCrewName("   "), "");
});
