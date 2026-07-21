/**
 * prompt-sections.test.mjs — unit tests for lib/prompt-sections.mjs.
 *
 * Covers: preamble is implicit prio 1, marker parsing + stripping, untagged-section
 * default, `###` subheadings staying with their parent, and tier-based filtering
 * (floor / mid / full).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parsePromptSections, renderPromptForTier, promptTierMaxPrio, stripSectionMarkers } from "../lib/prompt-sections.mjs";

const SAMPLE = [
  "You are the agent. Identity line.",
  "",
  "## Keep me <!-- construct:prio=1 -->",
  "must-keep body",
  "### nested",
  "still in keep-me",
  "",
  "## Mid section <!-- construct:prio=2 -->",
  "mid body",
  "",
  "## Untagged section",
  "defaults to prio 2",
  "",
  "## Full only <!-- construct:prio=3 -->",
  "verbose body",
].join("\n");

test("preamble before first heading is implicit prio 1", () => {
  const sections = parsePromptSections(SAMPLE);
  assert.equal(sections[0].heading, null);
  assert.equal(sections[0].prio, 1);
  assert.match(sections[0].content, /Identity line/);
});

test("prio marker is parsed and stripped from the heading", () => {
  const sections = parsePromptSections(SAMPLE);
  const keep = sections.find((s) => s.heading === "## Keep me");
  assert.ok(keep, "heading marker should be stripped");
  assert.equal(keep.prio, 1);
  assert.doesNotMatch(keep.content, /construct:prio/);
});

test("untagged ## section defaults to prio 2", () => {
  const sections = parsePromptSections(SAMPLE);
  const untagged = sections.find((s) => s.heading === "## Untagged section");
  assert.equal(untagged.prio, 2);
});

test("### subheading stays with its parent ## section", () => {
  const sections = parsePromptSections(SAMPLE);
  const keep = sections.find((s) => s.heading === "## Keep me");
  assert.match(keep.content, /### nested/);
  assert.match(keep.content, /still in keep-me/);
});

test("floor tier keeps only prio 1 (preamble + must-keep)", () => {
  const out = renderPromptForTier(SAMPLE, "floor");
  assert.match(out, /Identity line/);
  assert.match(out, /must-keep body/);
  assert.doesNotMatch(out, /mid body/);
  assert.doesNotMatch(out, /verbose body/);
});

test("mid tier adds prio 2, drops prio 3", () => {
  const out = renderPromptForTier(SAMPLE, "mid");
  assert.match(out, /mid body/);
  assert.match(out, /defaults to prio 2/);
  assert.doesNotMatch(out, /verbose body/);
});

test("full tier keeps everything", () => {
  const out = renderPromptForTier(SAMPLE, "full");
  assert.match(out, /verbose body/);
  assert.match(out, /mid body/);
  assert.match(out, /Identity line/);
});

test("unknown tier falls back to full", () => {
  assert.equal(promptTierMaxPrio("bogus"), promptTierMaxPrio("full"));
  assert.match(renderPromptForTier(SAMPLE, "bogus"), /verbose body/);
});

test("no emitted markers survive at any tier (full or floor)", () => {
  for (const tier of ["floor", "mid", "full"]) {
    assert.doesNotMatch(renderPromptForTier(SAMPLE, tier), /construct:prio/, `${tier} must not leak markers`);
  }
});

test("stripSectionMarkers removes markers and their leading whitespace", () => {
  assert.equal(stripSectionMarkers("## Heading <!-- construct:prio=2 -->"), "## Heading");
  assert.equal(stripSectionMarkers("plain text"), "plain text");
});
