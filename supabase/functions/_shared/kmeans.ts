// Deterministic k-means over high-dimensional embeddings (1536-d profile
// vectors). Seeded with farthest-point picks so repeated nightly runs produce
// stable cohorts for the same input set.

export interface KmeansResult {
  /** Cluster index per input vector. */
  assignments: number[];
  /** Cluster centroids, same dimensionality as the input. */
  centroids: number[][];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function distance(a: number[], b: number[]): number {
  return 1 - cosine(a, b);
}

/** Recommended cluster count for n subjects. */
export function suggestK(n: number, max = 8): number {
  if (n < 4) return 1;
  return Math.max(2, Math.min(max, Math.round(Math.sqrt(n / 2))));
}

export function kmeans(vectors: number[][], k: number, maxIters = 15): KmeansResult {
  const n = vectors.length;
  if (n === 0) return { assignments: [], centroids: [] };
  const kk = Math.max(1, Math.min(k, n));
  if (kk === 1) {
    return { assignments: new Array(n).fill(0), centroids: [mean(vectors)] };
  }

  // Farthest-point seeding: start from the first vector, then repeatedly take
  // the point that is furthest from every seed already chosen.
  const seeds: number[] = [0];
  while (seeds.length < kk) {
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      let nearest = Infinity;
      for (const s of seeds) nearest = Math.min(nearest, distance(vectors[i], vectors[s]));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = i;
      }
    }
    if (best < 0) break;
    seeds.push(best);
  }

  let centroids = seeds.map((i) => vectors[i].slice());
  const assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIters; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distance(vectors[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        moved = true;
      }
    }
    const next: number[][] = [];
    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      next.push(members.length ? mean(members) : centroids[c]);
    }
    centroids = next;
    if (!moved) break;
  }

  return { assignments, centroids };
}

function mean(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0;
  const out = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) out[i] += v[i] ?? 0;
  }
  for (let i = 0; i < dims; i++) out[i] /= vectors.length || 1;
  return out;
}
