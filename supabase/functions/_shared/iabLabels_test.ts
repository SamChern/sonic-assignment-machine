import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  crosswalkText,
  enrichNodeLabel,
  iabLabel,
  isPlaceholderLabel,
  normalizeIabCode,
} from "./iabLabels.ts";

Deno.test("resolves tier-1 codes", () => {
  assertEquals(iabLabel("IAB17"), "IAB17 - Sports");
  assertEquals(iabLabel("IAB12"), "IAB12 - News");
});

Deno.test("resolves known tier-2 codes", () => {
  assertEquals(iabLabel("IAB1-6"), "IAB1-6 - Arts & Entertainment: Music");
  assertEquals(iabLabel("IAB9-30"), "IAB9-30 - Hobbies & Interests: Video & Computer Games");
});

Deno.test("falls back to tier-1 when the tier-2 name is unknown", () => {
  assertEquals(iabLabel("IAB7-28"), "IAB7-28 - Health & Fitness");
});

Deno.test("tier-3 codes inherit their tier-2 name", () => {
  assertEquals(iabLabel("IAB12-2-2"), "IAB12-2-2 - News: National News");
});

Deno.test("normalizes casing and the stray IAB-N hyphen", () => {
  assertEquals(normalizeIabCode("iab-7"), "IAB7");
  assertEquals(iabLabel("iab-7"), "IAB7 - Health & Fitness");
  assertEquals(iabLabel(" iab2-10 "), "IAB2-10 - Automotive: Electric Vehicle");
});

Deno.test("unknown tier-1 keeps the raw code visible", () => {
  assertEquals(iabLabel("IAB99"), "IAB category IAB99");
  assertEquals(iabLabel(""), "IAB category ");
});

Deno.test("detects placeholder labels", () => {
  assert(isPlaceholderLabel("iab.iab7", "IAB category IAB7"));
  assert(isPlaceholderLabel("iab.iab7", "IAB7"));
  assert(isPlaceholderLabel("app.cat.games", "games"));
  assert(isPlaceholderLabel("iab.iab7", ""));
  assert(!isPlaceholderLabel("iab.iab17-2", "IAB17-2 - Sports"));
});

Deno.test("enriches placeholder labels", () => {
  assertEquals(enrichNodeLabel("iab.iab7", "IAB category IAB7"), "IAB7 - Health & Fitness");
  assertEquals(enrichNodeLabel("iab.iab9-5", "IAB category IAB9-5"), "IAB9-5 - Hobbies & Interests");
  assertEquals(enrichNodeLabel("app.cat.video_games", "video_games"), "Video Games");
  assertEquals(enrichNodeLabel("iab.iab17-2", "IAB17-2 - Sports"), "IAB17-2 - Sports");
});

Deno.test("crosswalk text drops code noise", () => {
  assertEquals(crosswalkText("iab.iab17-2", "IAB17-2 - Sports"), "the sound of media about Sports");
  assertEquals(
    crosswalkText("iab.iab1-6", "IAB category IAB1-6"),
    "the sound of media about Arts & Entertainment, Music",
  );
});
