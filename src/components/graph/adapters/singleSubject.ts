import {
  CATEGORY_COLORS,
  type SourceAnalysis,
  type CategorySimilarity,
  type SourcePairSimilarity,
  type SimilarityMetrics,
} from "@/components/network-graph/types";
import type { EngineLink, EngineNode } from "@/components/graph/engine";

/**
 * Data adapter for the single-subject / multi-source ontology graph: turns
 * analyzed sources into nodes, links and the similarity readout. Pure — no D3,
 * no DOM — so the layout math is unit-testable.
 */

export interface SubjectNode extends EngineNode {
  sourceName: string;
  category: string;
  score: number;
  color: string;
}

export interface SubjectLink extends EngineLink<SubjectNode> {
  strength: number;
}

export interface SubjectGraph {
  nodes: SubjectNode[];
  links: SubjectLink[];
  isSingleSource: boolean;
  metrics: SimilarityMetrics;
}

/** Node radius drives, and is driven by, the category score. */
export const subjectNodeRadius = (score: number) => 10 + (score / 100) * 25;

const sourceSimilarity = (a: SourceAnalysis, b: SourceAnalysis): number => {
  let totalDiff = 0;
  a.categories.forEach((cat, idx) => {
    totalDiff += Math.abs(cat.score - (b.categories[idx]?.score ?? 0));
  });
  const avgDiff = totalDiff / Math.max(1, a.categories.length);
  return Math.max(0, 1 - avgDiff / 100);
};

const categorySimilarity = (sources: SourceAnalysis[], categoryName: string) => {
  const scores = sources.map((s) => s.categories.find((c) => c.name === categoryName)?.score ?? 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length;
  return { similarity: Math.max(0, 1 - Math.sqrt(variance) / 50), variance };
};

/** Radial fingerprint: one pinned node per category plus a pinned center. */
function buildRadial(sources: SourceAnalysis[], nodes: SubjectNode[], width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.3;

  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * 2 * Math.PI - Math.PI / 2;
    node.x = centerX + radius * Math.cos(angle);
    node.y = centerY + radius * Math.sin(angle);
    node.fx = node.x;
    node.fy = node.y;
  });

  const links: SubjectLink[] = [];
  const petals = nodes.slice();

  nodes.push({
    id: "center",
    sourceName: sources[0].name,
    category: "Center",
    score: 100,
    color: "hsl(180, 70%, 55%)",
    radius: subjectNodeRadius(100),
    x: centerX,
    y: centerY,
    fx: centerX,
    fy: centerY,
  });

  // Radial spokes: thickness carries the category score (connection strength).
  petals.forEach((node) => {
    links.push({ source: "center", target: node.id, strength: node.score / 100 });
  });

  // Weaker ring links between neighbouring categories.
  for (let i = 0; i < petals.length; i++) {
    const next = petals[(i + 1) % petals.length];
    if (next.id !== petals[i].id) {
      links.push({ source: petals[i].id, target: next.id, strength: 0.2 });
    }
  }

  return links;
}

/** Multi-source clustering: category cohesion, per-source fingerprint, cross-source deltas. */
function buildClustered(sources: SourceAnalysis[], nodes: SubjectNode[]) {
  const links: SubjectLink[] = [];
  const categorySimilarities: CategorySimilarity[] = [];
  const categoryNames = Array.from(new Set(nodes.map((n) => n.category)));

  categoryNames.forEach((categoryName) => {
    const categoryNodes = nodes.filter((n) => n.category === categoryName);
    const { similarity, variance } = categorySimilarity(sources, categoryName);

    categorySimilarities.push({
      name: categoryName,
      similarity,
      variance,
      interpretation: similarity > 0.75 ? "high" : similarity > 0.5 ? "moderate" : "low",
    });

    for (let i = 0; i < categoryNodes.length; i++) {
      for (let j = i + 1; j < categoryNodes.length; j++) {
        links.push({
          source: categoryNodes[i].id,
          target: categoryNodes[j].id,
          strength: 0.7 + similarity * 0.2,
        });
      }
    }
  });

  sources.forEach((source) => {
    const sourceNodes = nodes.filter((n) => n.sourceName === source.name);
    for (let i = 0; i < sourceNodes.length; i++) {
      for (let j = i + 1; j < sourceNodes.length; j++) {
        links.push({
          source: sourceNodes[i].id,
          target: sourceNodes[j].id,
          strength: ((sourceNodes[i].score + sourceNodes[j].score) / 200) * 0.5,
        });
      }
    }
  });

  categoryNames.forEach((categoryName) => {
    const categoryNodes = nodes.filter((n) => n.category === categoryName);
    const perSource = sources
      .map((s) => categoryNodes.find((n) => n.sourceName === s.name))
      .filter((n): n is SubjectNode => Boolean(n));

    for (let i = 0; i < perSource.length; i++) {
      for (let j = i + 1; j < perSource.length; j++) {
        const similarity = Math.max(0, 1 - Math.abs(perSource[i].score - perSource[j].score) / 100);
        if (similarity > 0.3) {
          links.push({ source: perSource[i].id, target: perSource[j].id, strength: similarity * 0.2 });
        }
      }
    }
  });

  return { links, categorySimilarities };
}

export function buildSubjectGraph(
  sources: SourceAnalysis[],
  width: number,
  height: number,
): SubjectGraph {
  const isSingleSource = sources.length === 1;

  const nodes: SubjectNode[] = [];
  sources.forEach((source) => {
    source.categories.forEach((category) => {
      nodes.push({
        id: `${source.name}::${category.name}`,
        sourceName: source.name,
        category: category.name,
        score: category.score,
        color: CATEGORY_COLORS[category.name] || "hsl(180, 70%, 55%)",
        radius: subjectNodeRadius(category.score),
      });
    });
  });

  const links: SubjectLink[] = [];
  let categorySimilarities: CategorySimilarity[] = [];

  if (isSingleSource) {
    links.push(...buildRadial(sources, nodes, width, height));
  } else {
    const built = buildClustered(sources, nodes);
    links.push(...built.links);
    categorySimilarities = built.categorySimilarities;
  }

  const avgSim = links.length
    ? links.reduce((sum, link) => sum + link.strength, 0) / links.length
    : 0;

  const sourcePairs: SourcePairSimilarity[] = [];
  if (!isSingleSource) {
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        sourcePairs.push({
          source1: sources[i].name,
          source2: sources[j].name,
          similarity: sourceSimilarity(sources[i], sources[j]),
        });
      }
    }
  }
  sourcePairs.sort((a, b) => b.similarity - a.similarity);

  const sorted = [...categorySimilarities].sort((a, b) => b.similarity - a.similarity);

  return {
    nodes,
    links,
    isSingleSource,
    metrics: {
      overall: Math.round(avgSim * 100),
      byCategory: categorySimilarities,
      sourcePairs: sourcePairs.slice(0, 5),
      dominantCategory: sorted[0]?.name,
      distinctiveCategory: sorted[sorted.length - 1]?.name,
    },
  };
}
