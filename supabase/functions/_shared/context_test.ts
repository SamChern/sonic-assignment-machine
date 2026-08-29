import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNeighborExemplars,
  CATALOG_DIMS,
  describeBridge,
  describeTagSubject,
  padToCatalog,
  pickBridgeRoute,
  pickNodeVector,
  toVector,
  weightedTagVector,
} from "./context.ts";

Deno.test("toVector parses arrays and pgvector text", () => {
  assertEquals(toVector([1, 2, 3]), [1, 2, 3]);
  assertEquals(toVector("[0.5, -1, 2]"), [0.5, -1, 2]);
  assertEquals(toVector(null), null);
  assertEquals(toVector("nope"), null);
  assertEquals(toVector([]), null);
});

Deno.test("pickNodeVector prefers grounded audio embedding", () => {
  const picked = pickNodeVector({
    embedding: [1, 1, 1],
    audio_embedding: [9, 9],
    grounding_count: 3,
  });
  assertEquals(picked, { vector: [9, 9], space: "audio" });
});

Deno.test("pickNodeVector falls back to text embedding when ungrounded", () => {
  const picked = pickNodeVector({
    embedding: [1, 2],
    audio_embedding: [9, 9],
    grounding_count: 0,
  });
  assertEquals(picked, { vector: [1, 2], space: "text" });
});

Deno.test("pickNodeVector returns null with no vectors", () => {
  assertEquals(pickNodeVector({ grounding_count: 5 }), null);
});

Deno.test("buildNeighborExemplars produces per-neighbor exemplars sorted by similarity", () => {
  const ctx = buildNeighborExemplars(
    [
      {
        id: "a",
        name: "A",
        similarity: 0.42,
        emotional_score: 70,
        cognitive_score: 30,
        social_score: 50,
        communication_score: 60,
        contextual_score: 40,
        artistic_score: 80,
      },
      {
        id: "b",
        name: "B",
        similarity: 0.91,
        emotional_score: 20,
        cognitive_score: 80,
        social_score: 45,
        communication_score: 55,
        contextual_score: 35,
        artistic_score: 65,
      },
    ],
    new Map([["b", ["ctv.talk", "web.topic.news"]]]),
  );

  assertEquals(ctx.ids, ["b", "a"]);
  assertEquals(ctx.exemplars[0].similarity, 0.91);
  assertEquals(ctx.exemplars[0].six_scores.cognitive, 80);
  assertEquals(ctx.exemplars[0].top_tags, ["ctv.talk", "web.topic.news"]);
  assertEquals(ctx.text.includes("exemplars=2"), true);
  assertEquals(ctx.text.includes("tags=[ctv.talk,web.topic.news]"), true);
});

Deno.test("buildNeighborExemplars is empty-safe and drops scoreless rows", () => {
  assertEquals(buildNeighborExemplars(null).exemplars.length, 0);
  assertEquals(buildNeighborExemplars([]).text, "");
  assertEquals(buildNeighborExemplars([{ id: "x", similarity: 0.5 }]).exemplars.length, 0);
});

Deno.test("weightedTagVector normalizes by weight and unit length", () => {
  const out = weightedTagVector([
    { embedding: [1, 0], weight: 3, grounding_count: 0 },
    { embedding: [0, 1], weight: 1, grounding_count: 0 },
  ])!;
  assertEquals(out.space, "text");
  assertEquals(out.used, 2);
  assertEquals(out.weight_sum, 4);
  assertAlmostEquals(Math.hypot(...out.vector), 1, 1e-9);
  // 0.75 vs 0.25 pre-normalization → x stays dominant.
  assertAlmostEquals(out.vector[0] / out.vector[1], 3, 1e-9);
});

Deno.test("weightedTagVector picks the dominant space and ignores mixed dims", () => {
  const out = weightedTagVector([
    { audio_embedding: [1, 0, 0], grounding_count: 2, weight: 5 },
    { embedding: [0, 1], grounding_count: 0, weight: 1 },
  ])!;
  assertEquals(out.space, "audio");
  assertEquals(out.used, 1);
});

Deno.test("weightedTagVector returns null when nothing usable", () => {
  assertEquals(weightedTagVector([]), null);
  assertEquals(weightedTagVector([{ weight: 2 }]), null);
});

Deno.test("describeTagSubject flags the tag-only subject for the prompt", () => {
  const nodes = [{ code: "ctv.talk", embedding: [1, 0], weight: 2 }];
  const text = describeTagSubject(nodes, weightedTagVector(nodes));
  assertEquals(text.includes("subject=tags_only"), true);
  assertEquals(text.includes("tag_weights=[ctv.talk:2]"), true);
  assertEquals(text.includes("subject_vector=text:2d"), true);
  assertEquals(describeTagSubject([], null).includes("subject_vector=none"), true);
});


Deno.test("weightedTagVector reports tags dropped from the other space", () => {
  const out = weightedTagVector([
    { audio_embedding: [1, 0, 0], grounding_count: 3, weight: 4 },
    { embedding: [0, 1, 0, 0], grounding_count: 0, weight: 1 },
  ])!;
  assertEquals(out.space, "audio");
  assertEquals(out.used, 1);
  assertEquals(out.dropped, 1);
  assertEquals(
    describeTagSubject(
      [{ code: "a", audio_embedding: [1, 0, 0], grounding_count: 3, weight: 4 }],
      out,
    ).includes("tags_other_space=1"),
    true,
  );
});

Deno.test("pickBridgeRoute picks native, bridge, then pad", () => {
  assertEquals(pickBridgeRoute(CATALOG_DIMS, null), "native");
  assertEquals(
    pickBridgeRoute(512, { from_dim: 512, to_dim: CATALOG_DIMS }),
    "bridge",
  );
  assertEquals(pickBridgeRoute(512, null), "pad");
  // A bridge for a different width pair must not be used.
  assertEquals(
    pickBridgeRoute(512, { from_dim: 768, to_dim: CATALOG_DIMS }),
    "pad",
  );
});

Deno.test("padToCatalog tiles to the catalog width and normalizes", () => {
  const out = padToCatalog([1, 0, 0], 6);
  assertEquals(out.length, 6);
  assertAlmostEquals(Math.sqrt(out.reduce((s, x) => s + x * x, 0)), 1, 1e-9);
  assertAlmostEquals(out[0], out[3], 1e-9);
  assertEquals(padToCatalog([], 6), []);
});

Deno.test("describeBridge records the route taken", () => {
  assertEquals(describeBridge("native", 1536), "vector_route=native dims=1536");
  assertEquals(
    describeBridge("bridge", 512, "clap-1536").includes("bridge=clap-1536"),
    true,
  );
  assertEquals(describeBridge("pad", 512), "vector_route=pad from=512d to=1536d");
});
