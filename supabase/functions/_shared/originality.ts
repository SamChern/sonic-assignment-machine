// Originality Score — how distinctive a source is, given what we actually know.
//
// Three ingredients, all already measured elsewhere:
//
//   1. Grounding confidence  — did we listen to the audio, and how decisive was
//      the read (grounding_level + the per-analysis confidence value)?
//   2. Taxonomy match        — how tightly the audio lands on ontology nodes.
//      A source that maps hard onto a handful of very common nodes is generic;
//      one that lands on fewer, weaker-matching nodes is unusual.
//   3. Musical craft         — spread across pitch / rhythm / timbre. Audio that
//      is strong on one axis and quiet on another has a signature; audio that is
//      flat and average across all three is stock.
//
// Deterministic, bounded, no extra model call. Ungrounded metadata-only sources
// get a low `evidence` weight so the UI can mark the score as provisional rather
// than pretending a filename is original.

export interface OriginalityInput {
  /** 0-1 per-analysis confidence. */
  confidence?: number | null;
  grounding_level?: string | null;
  /** Taxonomy/CLAP matches with a 0-1 similarity. */
  tags?: { code?: string | null; label?: string | null; similarity?: number | null }[];
  musical?: { pitch: number; rhythm: number; timbre: number; musicality: number } | null;
}

export interface OriginalityResult {
  /** 0-100. Higher = more distinctive. */
  score: number;
  /** 0-1 — how much evidence stands behind the score. */
  evidence: number;
  parts: {
    grounding: number;
    taxonomy: number;
    craft: number;
  };
  /** Short reason string for the UI. */
  summary: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const pct = (n: number) => Math.round(clamp01(n) * 1000) / 10;

const GROUNDING_WEIGHT: Record<string, number> = {
  grounded: 1,
  partial: 0.65,
  inferred: 0.4,
  ungrounded: 0.15,
};

export function computeOriginality(input: OriginalityInput): OriginalityResult {
  const confidence = clamp01(Number(input.confidence ?? 0));
  const groundWeight = GROUNDING_WEIGHT[String(input.grounding_level ?? "").toLowerCase()] ?? 0.3;
  // Grounding contributes as *trust*, not as originality itself.
  const grounding = clamp01(0.35 * groundWeight + 0.65 * confidence);

  // --- Taxonomy match ---------------------------------------------------
  // Mean similarity of the matched nodes: a very high mean means the audio is a
  // textbook example of an existing node (less original); a low-but-present mean
  // means it sits between nodes (more original). No tags at all is unknown, not
  // original, so it lands mid-scale with low evidence.
  const sims = (input.tags ?? [])
    .map((t) => Number(t?.similarity))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => clamp01(n));
  const meanSim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  const spreadSim = sims.length > 1
    ? clamp01(Math.max(...sims) - Math.min(...sims))
    : 0;
  const taxonomy = sims.length
    ? clamp01(0.75 * (1 - meanSim) + 0.25 * spreadSim)
    : 0.5;

  // --- Musical craft ----------------------------------------------------
  // Distance of the pitch/rhythm/timbre trio from a flat average profile,
  // scaled by how much musical signal there is to talk about.
  let craft = 0.5;
  const m = input.musical;
  if (m && Number.isFinite(m.pitch)) {
    const trio = [m.pitch, m.rhythm, m.timbre].map((v) => clamp01(Number(v) / 100));
    const mean = trio.reduce((a, b) => a + b, 0) / trio.length;
    const dev = Math.sqrt(
      trio.reduce((a, v) => a + (v - mean) ** 2, 0) / trio.length,
    );
    const signature = clamp01(dev / 0.25); // 25pt spread ≈ fully distinctive
    const reach = clamp01(Math.max(...trio));
    const musicality = clamp01(Number(m.musicality ?? 0));
    craft = clamp01((0.6 * signature + 0.4 * reach) * musicality + 0.5 * (1 - musicality));
  }

  const score = pct(0.3 * grounding + 0.35 * taxonomy + 0.35 * craft);

  // Evidence: what fraction of the three ingredients was actually observed.
  const evidence = clamp01(
    0.4 * groundWeight +
      0.3 * (sims.length ? 1 : 0) +
      0.3 * clamp01(Number(m?.musicality ?? 0)),
  );

  const summary = !sims.length && !m
    ? "Provisional — metadata only, no audio listened to yet."
    : craft > 0.66 && taxonomy > 0.55
      ? "Distinctive craft that sits between existing ontology nodes."
      : taxonomy < 0.35
        ? "Close to a textbook example of common ontology nodes."
        : craft < 0.35
          ? "Even pitch/rhythm/timbre profile — familiar rather than singular."
          : "Mixed: recognisable shape with some signature of its own.";

  return {
    score,
    evidence: Math.round(evidence * 1000) / 1000,
    parts: { grounding: pct(grounding), taxonomy: pct(taxonomy), craft: pct(craft) },
    summary,
  };
}
