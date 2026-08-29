// Step 6 verification: Activation files must refuse under-sized cohorts and,
// when eligible, contain exactly one uppercase 32-hex EID per row.
import { describe, expect, it } from "vitest";
import {
  activationCsv,
  activationDate,
  activationObjectKey,
  activationRefusal,
  buildActivationFile,
  MIN_ACTIVATION_MEMBERS,
} from "../../supabase/functions/_shared/activationFile";

const EID_ROW = /^[0-9A-F]{32}$/;

const members = (n: number, opts: { holdout?: number; prefix?: string } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    subject_key: `${opts.prefix ?? "device"}-${i}`,
    holdout: i < (opts.holdout ?? 0),
  }));

describe("activation eligibility", () => {
  it("refuses a cohort under the 1,000-member floor", () => {
    expect(activationRefusal(999, false, "small-cohort")).toContain("not export eligible");
    expect(activationRefusal(999, false, "small-cohort")).toContain("999");
  });

  it("refuses a cohort at member floor but flagged ineligible", () => {
    expect(activationRefusal(5000, false, "flagged")).not.toBeNull();
  });

  it("allows an eligible cohort at or above the floor", () => {
    expect(activationRefusal(MIN_ACTIVATION_MEMBERS, true, "ok")).toBeNull();
    expect(activationRefusal(12_345, true, "ok")).toBeNull();
  });
});

describe("activation file body", () => {
  it("emits one uppercase 32-hex EID per row with no header", async () => {
    const file = await buildActivationFile(members(50));
    const rows = activationCsv(file.eids).split("\n");
    expect(rows.at(-1)).toBe(""); // trailing newline
    const body = rows.slice(0, -1);
    expect(body).toHaveLength(50);
    for (const row of body) expect(row).toMatch(EID_ROW);
  });

  it("sorts and dedupes rows", async () => {
    const dupes = [...members(10), ...members(10)];
    const file = await buildActivationFile(dupes);
    expect(file.eids).toHaveLength(10);
    expect([...file.eids].sort()).toEqual(file.eids);
  });

  it("withholds holdout members from the file", async () => {
    const file = await buildActivationFile(members(30, { holdout: 8 }));
    expect(file.heldOut).toBe(8);
    expect(file.eids).toHaveLength(22);
  });

  it("keeps subject keys aligned with their EIDs and never leaks them into the body", async () => {
    const file = await buildActivationFile(members(5));
    expect(file.subjectKeys).toHaveLength(file.eids.length);
    const csv = activationCsv(file.eids);
    for (const key of file.subjectKeys) expect(csv).not.toContain(key);
  });

  it("skips members whose key cannot be normalized", async () => {
    const file = await buildActivationFile([
      { subject_key: "" },
      { subject_key: "   " },
      { subject_key: "device-1" },
    ]);
    expect(file.skipped).toBe(2);
    expect(file.eids).toHaveLength(1);
  });

  it("is deterministic across runs", async () => {
    const a = await buildActivationFile(members(20));
    const b = await buildActivationFile(members(20));
    expect(a.eids).toEqual(b.eids);
  });
});

describe("outbound object key", () => {
  it("matches the outbound/activation partition layout", () => {
    expect(activationObjectKey("high-energy", "2026-02-14")).toBe(
      "outbound/activation/dt=2026-02-14/cohort=high-energy/part-000.csv.gz",
    );
  });

  it("falls back to today for a malformed dt", () => {
    expect(activationDate("nope")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(activationDate("2026-01-02")).toBe("2026-01-02");
  });
});
