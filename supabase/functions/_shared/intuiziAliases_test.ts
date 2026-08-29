// The compatibility harness grades deliveries with FEATURE_ALIASES; these tests
// pin those lists to what normalizeRow() actually does for the three real
// Intuizi column sets, so the two can never drift apart again.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FEATURE_ALIASES,
  isWebShaped,
  matchAliasGroups,
  normalizeRow,
  reportTypeFromKey,
  unrecognizedColumns,
} from "./intuizi.ts";

const CTV_ROW = {
  primary_identifier: "abc123",
  ip: "1.2.3.4",
  ctv_taxonomy: "dev-1",
  contenttype: "Series",
  contentgenre: "Documentary",
  channelname: "PBS",
  iab_cats: "IAB1|IAB3",
  country: "US",
  provider: "intuizi",
  date_utc: "2026-08-01T20:15:00Z",
};

const WEB_ROW = {
  primary_identifier: "abc123",
  domain: "cyclingnews.com",
  page: "https://cyclingnews.com/racing/tour-de-france/stage-9",
  ref: "https://news.google.com/",
  useragent: "Mozilla/5.0",
  country: "US",
  iab_codes: "IAB17",
  signals: "12",
  day: "2026-08-01",
  provider: "intuizi",
};

const DEMO_ROW = {
  EID: "abc123",
  Gender: "F",
  MaritalStatus: "Married",
  AnnualIncome: "100000-149999",
  Age: "35-44",
  Visits: "4",
};

const cols = (row: Record<string, unknown>) => Object.keys(row);

Deno.test("ctv delivery satisfies every ctv alias group", () => {
  const { matched, missing } = matchAliasGroups(FEATURE_ALIASES.ctv, cols(CTV_ROW));
  assertEquals(missing.length, 0);
  assertEquals(matched.length, FEATURE_ALIASES.ctv.length);
  assert(!isWebShaped(cols(CTV_ROW)));
  assert(normalizeRow("ctv", CTV_ROW)!.tags.length >= 4);
});

Deno.test("web delivery is web-shaped and satisfies the web groups, not ctv's", () => {
  assert(isWebShaped(cols(WEB_ROW)));
  const web = matchAliasGroups(FEATURE_ALIASES.web, cols(WEB_ROW));
  assertEquals(web.missing.length, 0);

  // It really does normalize — the old harness graded this as blocking.
  const normalized = normalizeRow("ctv", WEB_ROW)!;
  const codes = normalized.tags.map((t) => t.code);
  assert(codes.some((c) => c.startsWith("ctv.channel.")), codes.join(","));
  assert(codes.some((c) => c.startsWith("iab.")), codes.join(","));
  assert(codes.some((c) => c.startsWith("web.topic.")), codes.join(","));
  assert(codes.some((c) => c.startsWith("web.referrer.")), codes.join(","));

  // Graded against ctv's own groups it would look empty — hence the web shape.
  const asCtv = matchAliasGroups(FEATURE_ALIASES.ctv, cols(WEB_ROW));
  assert(asCtv.missing.length > 0);
});

Deno.test("demographics gap is reported as unmapped columns, not as a code fix", () => {
  const { missing } = matchAliasGroups(FEATURE_ALIASES.demographics, cols(DEMO_ROW));
  // Age is an accepted alias; the provider's other labels are not.
  assert(missing.some((g) => g.name === "income band"));
  const unmapped = unrecognizedColumns(FEATURE_ALIASES.demographics, cols(DEMO_ROW));
  assertEquals(unmapped.sort(), ["AnnualIncome", "Gender", "MaritalStatus"]);
});


Deno.test("provenance columns are never reported as gaps", () => {
  const unmapped = unrecognizedColumns(FEATURE_ALIASES.web, cols(WEB_ROW));
  assertEquals(unmapped, []);
});

Deno.test("report type prefers the leading report token, not the account slug", () => {
  // Every Intuizi filename ends `_sonicsim_ctv_audio_signals_<activation>`, so a
  // naive scan captured every delivery as `ctv`.
  const cases: [string, string][] = [
    ["20260828_demographics_sonicsim_ctv_audio_signals_5580.parquet", "demographics"],
    ["20260828_apps_report_sonicsim_ctv_audio_signals_5580.parquet", "apps"],
    ["20260828_visitation_sonicsim_ctv_audio_signals_5580.parquet", "visitation"],
    ["20260828_origin_sonicsim_ctv_audio_signals_5580.parquet", "origin"],
    ["20260828_ctv_report_sonicsim_ctv_audio_signals_5580.parquet", "ctv"],
    ["20260828_web_report_sonicsim_ctv_audio_signals_5580.parquet", "ctv"],
  ];
  for (const [key, want] of cases) {
    assertEquals(reportTypeFromKey(key), want, key);
  }
  // Directory prefixes still win outright.
  assertEquals(reportTypeFromKey("demographics/20260828_ctv_x.parquet"), "demographics");
});
