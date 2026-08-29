import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  autoApproveTargets,
  applyDecision,
  audiosetSlug,
  audiosetText,
  buildAudioSetNodes,
  centroid,
  coerceOntology,
  familyKey,
  foldTo512,
  hasApproved,
  readCrosswalk,
} from "./audioset.ts";

const ONTOLOGY = [
  { id: "/m/09x0r", name: "Speech", child_ids: ["/m/05zppz", "/m/02zsn"] },
  { id: "/m/05zppz", name: "Male speech, man speaking", child_ids: [] },
  { id: "/m/02zsn", name: "Female speech, woman speaking", child_ids: [] },
  { id: "/m/04rlf", name: "Music", description: "Music is an art form.", child_ids: ["/m/04szw"] },
  { id: "/m/04szw", name: "Musical instrument", child_ids: ["/m/09x0r"] },
];

Deno.test("audiosetSlug normalizes names", () => {
  assertEquals(audiosetSlug("Male speech, man speaking"), "male_speech_man_speaking");
  assertEquals(audiosetSlug("Music (rock)"), "music_rock");
  assertEquals(audiosetSlug("!!!"), "unnamed");
});

Deno.test("coerceOntology accepts array and wrapper", () => {
  assertEquals(coerceOntology(ONTOLOGY).length, 5);
  assertEquals(coerceOntology({ ontology: ONTOLOGY }).length, 5);
  assertEquals(coerceOntology({ nope: 1 }).length, 0);
  assertEquals(coerceOntology([{ id: "x" }]).length, 0);
});

Deno.test("buildAudioSetNodes preserves hierarchy with unique codes", () => {
  const nodes = buildAudioSetNodes(ONTOLOGY);
  assertEquals(nodes.length, 5);
  const byCode = new Map(nodes.map((n) => [n.code, n]));

  assertEquals(byCode.get("aset.music")!.parent_code, null);
  assertEquals(byCode.get("aset.musical_instrument")!.parent_code, "aset.music");
  // Speech has two parents in the source (root list + musical_instrument);
  // BFS keeps the shallowest one.
  assertEquals(byCode.get("aset.speech")!.parent_code, "aset.musical_instrument");
  assertEquals(byCode.get("aset.male_speech_man_speaking")!.parent_code, "aset.speech");
  assertEquals(new Set(nodes.map((n) => n.code)).size, nodes.length);
  assertEquals(byCode.get("aset.music")!.description, "Music is an art form.");
});

Deno.test("buildAudioSetNodes de-duplicates identical labels", () => {
  const nodes = buildAudioSetNodes([
    { id: "a", name: "Bell", child_ids: [] },
    { id: "b", name: "Bell", child_ids: [] },
  ]);
  assertEquals(nodes.map((n) => n.code).sort(), ["aset.bell", "aset.bell__2"]);
});

Deno.test("readCrosswalk / hasApproved tolerate junk", () => {
  assertEquals(readCrosswalk(null), null);
  assertEquals(readCrosswalk({}), null);
  assertEquals(hasApproved({ audioset: { matches: [{ code: "aset.speech" }] } }), false);
  assertEquals(hasApproved({ audioset: { matches: [{ code: "aset.speech", approved: true }] } }), true);
});

Deno.test("applyDecision flips only targeted matches and keeps sibling keys", () => {
  const before = {
    audioset_source: { mid: "/m/1" },
    audioset: {
      version: "audioset-v1",
      proposed_at: "2026-01-01T00:00:00.000Z",
      matches: [
        { code: "aset.speech", label: "Speech", similarity: 0.9, approved: false },
        { code: "aset.music", label: "Music", similarity: 0.7, approved: false },
      ],
    },
  };

  const approved = applyDecision(before, ["aset.speech"], "approve", "admin-1");
  const block = readCrosswalk(approved)!;
  assertEquals(block.matches.find((m) => m.code === "aset.speech")!.approved, true);
  assertEquals(block.matches.find((m) => m.code === "aset.music")!.approved, false);
  assertEquals(block.approved_by, "admin-1");
  assert(hasApproved(approved));
  assertEquals((approved as Record<string, unknown>).audioset_source, before.audioset_source);

  const rejected = applyDecision(approved, ["aset.speech"], "reject", "admin-1");
  assertEquals(hasApproved(rejected), false);
  assertEquals(readCrosswalk(rejected)!.matches[0].rejected, true);
  assertEquals(readCrosswalk(rejected)!.approved_by, null);

  const cleared = applyDecision(rejected, ["aset.speech"], "clear", null);
  assertEquals(readCrosswalk(cleared)!.matches[0].rejected, false);
});

Deno.test("audiosetText builds a CLAP-friendly prompt", () => {
  assertEquals(audiosetText({ label: "Speech" }), "the sound of Speech");
  assert(audiosetText({ label: "Music", description: "An art form." }).includes("An art form."));
});

Deno.test("autoApproveTargets picks the best match above the threshold", () => {
  const cw = {
    audioset: {
      version: "audioset-v1",
      matches: [
        { code: "aset.a", label: "A", similarity: 0.62, approved: false, rejected: false },
        { code: "aset.b", label: "B", similarity: 0.81, approved: false, rejected: false },
        { code: "aset.c", label: "C", similarity: 0.74, approved: false, rejected: false },
      ],
    },
  };
  assertEquals(autoApproveTargets(cw, 0.7), ["aset.b"]);
  assertEquals(autoApproveTargets(cw, 0.7, 2), ["aset.b", "aset.c"]);
  assertEquals(autoApproveTargets(cw, 0.9), []);
});

Deno.test("autoApproveTargets respects human decisions", () => {
  const rejectedBest = {
    audioset: {
      version: "audioset-v1",
      matches: [
        { code: "aset.b", label: "B", similarity: 0.81, approved: false, rejected: true },
        { code: "aset.c", label: "C", similarity: 0.74, approved: false, rejected: false },
      ],
    },
  };
  assertEquals(autoApproveTargets(rejectedBest, 0.7), ["aset.c"]);

  const alreadyApproved = {
    audioset: {
      version: "audioset-v1",
      matches: [{ code: "aset.b", label: "B", similarity: 0.81, approved: true, rejected: false }],
    },
  };
  assertEquals(autoApproveTargets(alreadyApproved, 0.7), []);
  assertEquals(autoApproveTargets(null, 0.7), []);
});

Deno.test("foldTo512 inverts identity tiling and normalizes", () => {
  const base = Array.from({ length: 512 }, (_, i) => Math.sin(i) );
  const tiled = [...base, ...base, ...base];
  const folded = foldTo512(tiled)!;
  assertEquals(folded.length, 512);
  const norm = Math.sqrt(folded.reduce((a, x) => a + x * x, 0));
  assert(Math.abs(norm - 1) < 1e-6);
  // Direction preserved: cosine against the normalized base is ~1.
  const bn = Math.sqrt(base.reduce((a, x) => a + x * x, 0));
  const cos = base.reduce((a, x, i) => a + (x / bn) * folded[i], 0);
  assert(cos > 0.999, `cosine ${cos}`);
});

Deno.test("foldTo512 rejects unusable widths", () => {
  assertEquals(foldTo512([]), null);
  assertEquals(foldTo512([1, 2, 3]), null);
  assertEquals(foldTo512(new Array(512).fill(1))?.length, 512);
});

Deno.test("readCrosswalk preserves the via evidence tag", () => {
  const block = readCrosswalk({
    audioset: { matches: [{ code: "aset.speech", similarity: 0.8, via: "text_bridge" }] },
  });
  assertEquals(block?.matches[0].via, "text_bridge");
});

Deno.test("familyKey resolves IAB tiers and dotted parents", () => {
  assertEquals(familyKey("iab.iab17-2"), "iab.iab17");
  assertEquals(familyKey("iab.iab9-30-1"), "iab.iab9");
  assertEquals(familyKey("ctv.genre.sports.nfl"), "ctv.genre.sports");
  assertEquals(familyKey("app.category"), null);
});

Deno.test("centroid averages and normalizes", () => {
  const c = centroid([[1, 0], [0, 1]])!;
  assert(Math.abs(c[0] - c[1]) < 1e-9);
  assert(Math.abs(Math.hypot(c[0], c[1]) - 1) < 1e-9);
  assertEquals(centroid([]), null);
});
