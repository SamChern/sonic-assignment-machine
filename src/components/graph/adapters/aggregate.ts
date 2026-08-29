import { Heart, Brain, Users, MessageCircle, Map, Palette, type LucideIcon } from "lucide-react";
import type { EngineLink, EngineNode } from "@/components/graph/engine";

/**
 * Data adapter for the aggregate fingerprint graph: k-means clustering over the
 * six-axis fingerprints, plus node/link construction. Pure math — no D3, no DOM.
 */

export interface UserFingerprint {
  user_id: string;
  username?: string | null;
  avatar_url?: string | null;
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
  total_sources_analyzed: number;
  fingerprint_confidence?: number;
}

export interface CategoryAxis {
  key: string;
  name: string;
  color: string;
  icon: LucideIcon;
}

export interface Cluster {
  id: number;
  centroid: number[];
  members: UserFingerprint[];
  color: string;
  label: string;
  dominantCategory: CategoryAxis;
}

export interface AggregateNode extends EngineNode {
  fingerprint: UserFingerprint;
  color: string;
  cluster?: Cluster;
  opacity: number;
}

export interface AggregateLink extends EngineLink<AggregateNode> {
  source: AggregateNode;
  target: AggregateNode;
  similarity: number;
  sameCluster: boolean;
}

export const CATEGORY_AXES: CategoryAxis[] = [
  { key: "emotional_avg", name: "Emotional", color: "#ef4444", icon: Heart },
  { key: "cognitive_avg", name: "Cognitive", color: "#3b82f6", icon: Brain },
  { key: "social_avg", name: "Social", color: "#22c55e", icon: Users },
  { key: "communication_avg", name: "Communication", color: "#eab308", icon: MessageCircle },
  { key: "contextual_avg", name: "Contextual", color: "#a855f7", icon: Map },
  { key: "artistic_avg", name: "Artistic", color: "#ec4899", icon: Palette },
];

/** Cluster hues, deliberately distinct from the six category colors. */
export const CLUSTER_COLORS = ["#06b6d4", "#f97316", "#84cc16", "#6366f1", "#f43f5e", "#14b8a6"];

export const getVector = (fp: UserFingerprint): number[] =>
  CATEGORY_AXES.map((c) => Number(fp[c.key as keyof UserFingerprint]) || 0);

const euclidean = (v1: number[], v2: number[]): number =>
  Math.sqrt(v1.reduce((sum, val, i) => sum + (val - v2[i]) ** 2, 0));

export function calculateSimilarity(fp1: UserFingerprint, fp2: UserFingerprint): number {
  const a = getVector(fp1);
  const b = getVector(fp2);
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}

export function getDominantCategory(values: number[]): CategoryAxis {
  let maxIdx = 0;
  let maxVal = 0;
  values.forEach((val, i) => {
    if (val > maxVal) {
      maxVal = val;
      maxIdx = i;
    }
  });
  return CATEGORY_AXES[maxIdx];
}

/** k-means++ seeding, then Lloyd iterations until assignments settle. */
export function kMeansClustering(
  fingerprints: UserFingerprint[],
  k: number,
  maxIterations = 50,
): Cluster[] {
  const size = Math.min(k, fingerprints.length);
  if (size <= 0) return [];

  const vectors = fingerprints.map(getVector);
  const centroids: number[][] = [];
  const used = new Set<number>();

  const firstIdx = Math.floor(Math.random() * vectors.length);
  centroids.push([...vectors[firstIdx]]);
  used.add(firstIdx);

  while (centroids.length < size) {
    const distances = vectors.map((v, idx) => {
      if (used.has(idx)) return 0;
      const minDist = Math.min(...centroids.map((c) => euclidean(v, c)));
      return minDist * minDist;
    });
    let random = Math.random() * distances.reduce((a, b) => a + b, 0);
    let picked = false;
    for (let i = 0; i < distances.length; i++) {
      random -= distances[i];
      if (random <= 0 && !used.has(i)) {
        centroids.push([...vectors[i]]);
        used.add(i);
        picked = true;
        break;
      }
    }
    // Degenerate data (all points identical) leaves nothing to pick — stop.
    if (!picked) break;
  }

  let assignments: number[] = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    const next = vectors.map((v) => {
      let minDist = Infinity;
      let minIdx = 0;
      centroids.forEach((c, i) => {
        const dist = euclidean(v, c);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      });
      return minIdx;
    });
    if (next.every((a, i) => a === assignments[i])) break;
    assignments = next;

    for (let c = 0; c < centroids.length; c++) {
      const points = vectors.filter((_, i) => assignments[i] === c);
      if (points.length > 0) {
        centroids[c] = CATEGORY_AXES.map(
          (_, catIdx) => points.reduce((sum, p) => sum + p[catIdx], 0) / points.length,
        );
      }
    }
  }

  return centroids
    .map((centroid, idx) => {
      const dominantCategory = getDominantCategory(centroid);
      return {
        id: idx,
        centroid,
        members: fingerprints.filter((_, i) => assignments[i] === idx),
        color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
        label: `${dominantCategory.name}-dominant`,
        dominantCategory,
      };
    })
    .filter((c) => c.members.length > 0);
}

/** Elbow-method heuristic: more users tolerate more clusters, capped at 5. */
export function determineOptimalK(fingerprints: UserFingerprint[]): number {
  if (fingerprints.length <= 2) return 1;
  if (fingerprints.length <= 4) return 2;
  if (fingerprints.length <= 8) return 3;
  return Math.min(5, Math.ceil(fingerprints.length / 3));
}

/** Node radius grows with how much audio the user has actually analyzed. */
export const aggregateNodeRadius = (fp: UserFingerprint) => 20 + fp.total_sources_analyzed * 3;

export function buildAggregateGraph(
  fingerprints: UserFingerprint[],
  clusterOf: (userId: string) => Cluster | undefined,
  width: number,
  height: number,
): { nodes: AggregateNode[]; links: AggregateLink[] } {
  const nodes: AggregateNode[] = fingerprints.map((fp) => {
    const cluster = clusterOf(fp.user_id);
    const conf = Math.min(1, Math.max(0, Number(fp.fingerprint_confidence) || 0));
    return {
      id: fp.user_id,
      fingerprint: fp,
      radius: aggregateNodeRadius(fp),
      color: cluster?.color || getDominantCategory(getVector(fp)).color,
      cluster,
      // Sparse fingerprints fade rather than disappear: 0.35–1.0.
      opacity: 0.35 + conf * 0.65,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    };
  });

  const links: AggregateLink[] = [];
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const similarity = calculateSimilarity(fingerprints[i], fingerprints[j]);
      const sameCluster =
        clusterOf(fingerprints[i].user_id)?.id === clusterOf(fingerprints[j].user_id)?.id;
      if (similarity > 0.6 || sameCluster) {
        links.push({ source: nodes[i], target: nodes[j], similarity, sameCluster });
      }
    }
  }

  return { nodes, links };
}

export interface AggregateMetrics {
  averageSimilarity: number;
  pairs: { user1: string; user2: string; similarity: number }[];
  categoryAverages: (CategoryAxis & { avg: number })[];
}

export function buildAggregateMetrics(fingerprints: UserFingerprint[]): AggregateMetrics | null {
  if (fingerprints.length < 2) return null;

  const pairs: AggregateMetrics["pairs"] = [];
  let total = 0;
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const similarity = calculateSimilarity(fingerprints[i], fingerprints[j]);
      pairs.push({
        user1: fingerprints[i].username || "User",
        user2: fingerprints[j].username || "User",
        similarity,
      });
      total += similarity;
    }
  }

  return {
    averageSimilarity: pairs.length > 0 ? total / pairs.length : 0,
    pairs: pairs.sort((a, b) => b.similarity - a.similarity),
    categoryAverages: CATEGORY_AXES.map((cat) => ({
      ...cat,
      avg:
        fingerprints.reduce(
          (sum, fp) => sum + (Number(fp[cat.key as keyof UserFingerprint]) || 0),
          0,
        ) / fingerprints.length,
    })),
  };
}
