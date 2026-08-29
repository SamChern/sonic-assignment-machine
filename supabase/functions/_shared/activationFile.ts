// Activation-file assembly — the part of `activation-export` worth testing on
// its own: eligibility, EID normalization, holdout withholding, row formatting
// and object-key layout. No network, no database.

import { isActivationEid, toActivationEid } from "./activationEid.ts";
import { controlNumber } from "./control.ts";

/** Hard floor: an activation file is never smaller than this, whatever the registry says. */
export const MIN_ACTIVATION_MEMBERS = 1000;

/**
 * The effective export floor: `activation.min_members` from the Control Room,
 * never below the hard 1,000-member minimum.
 */
export async function activationMinMembers(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<number> {
  const v = await controlNumber(admin, "activation.min_members", MIN_ACTIVATION_MEMBERS, {
    min: MIN_ACTIVATION_MEMBERS,
    max: 1_000_000,
  });
  return Math.max(MIN_ACTIVATION_MEMBERS, Math.round(v));
}


export interface CohortMemberRow {
  subject_key: string;
  holdout?: boolean | null;
}

export interface ActivationFile {
  /** Uppercase 32-hex EIDs, sorted, deduped. */
  eids: string[];
  /** Subject keys that made it into the file, in the same order as `eids`. */
  subjectKeys: string[];
  /** Members withheld because they are in the measurement holdout. */
  heldOut: number;
  /** Members whose key could not be normalized to an EID (aggregate rows etc.). */
  skipped: number;
}

/** `outbound/activation/dt=YYYY-MM-DD/cohort=<slug>/part-000.csv.gz` */
export function activationObjectKey(slug: string, dt: string): string {
  return `outbound/activation/dt=${dt}/cohort=${slug}/part-000.csv.gz`;
}

/** Today in UTC, or the caller's `dt` when it is a valid ISO date. */
export function activationDate(dt?: string | null): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dt ?? "") ? dt! : new Date().toISOString().slice(0, 10);
}

/** Normalize cohort members into the file's rows. */
export async function buildActivationFile(members: CohortMemberRow[]): Promise<ActivationFile> {
  const byEid = new Map<string, string>();
  let heldOut = 0;
  let skipped = 0;

  for (const m of members) {
    if (m.holdout) {
      heldOut++;
      continue;
    }
    const eid = await toActivationEid(m.subject_key);
    if (eid && isActivationEid(eid)) {
      if (!byEid.has(eid)) byEid.set(eid, m.subject_key);
    } else {
      skipped++;
    }
  }

  const eids = Array.from(byEid.keys()).sort();
  return {
    eids,
    subjectKeys: eids.map((e) => byEid.get(e)!),
    heldOut,
    skipped,
  };
}

/** The file body: one EID per row, no header, trailing newline. */
export function activationCsv(eids: string[]): string {
  return eids.join("\n") + "\n";
}

/** Why this cohort may not be exported, or null when it may. */
export function activationRefusal(
  memberCount: number,
  exportEligible: boolean | null,
  slug: string,
  minMembers: number = MIN_ACTIVATION_MEMBERS,
): string | null {
  const floor = Math.max(MIN_ACTIVATION_MEMBERS, minMembers);
  if (exportEligible && memberCount >= floor) return null;
  return `cohort "${slug}" is not export eligible — ${memberCount} members, minimum is ${floor}`;
}

