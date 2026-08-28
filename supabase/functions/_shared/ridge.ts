// Step 11c — honest regression helpers.
//
// Ridge (L2-regularized) least squares plus a bootstrap that yields a
// confidence interval per coefficient. Small KPI datasets happily produce
// confident nonsense with plain OLS, so every coefficient we surface carries an
// interval and callers grey out any effect whose interval crosses zero.

/** Solves A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i][i]);
}

/**
 * Ridge fit. `X` rows must already include the leading intercept column; the
 * intercept is never penalized.
 */
export function fitRidge(X: number[][], y: number[], lambda: number): number[] | null {
  const p = X[0]?.length ?? 0;
  if (!p || X.length !== y.length) return null;
  const xtx = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) =>
      X.reduce((s, row) => s + row[i] * row[j], 0) + (i === j && i > 0 ? lambda * X.length : 0)
    )
  );
  const xty = Array.from({ length: p }, (_, i) => X.reduce((s, row, k) => s + row[i] * y[k], 0));
  return solveLinear(xtx, xty);
}

/** Deterministic 32-bit PRNG so a re-run of the same data reproduces the CI. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RidgeFit {
  beta: number[];
  /** [ci_low, ci_high] per coefficient, 2.5 / 97.5 bootstrap percentiles. */
  ci: [number, number][];
  r2: number;
  n: number;
  lambda: number;
  bootstrap_iters: number;
}

export function fitRidgeWithBootstrap(
  X: number[][],
  y: number[],
  opts: { lambda?: number; iters?: number; seed?: number } = {},
): RidgeFit | null {
  const lambda = opts.lambda ?? 1e-2;
  const iters = Math.max(20, Math.min(2000, opts.iters ?? 200));
  const beta = fitRidge(X, y, lambda);
  if (!beta) return null;

  const predict = (row: number[]) => row.reduce((s, v, i) => s + v * beta[i], 0);
  const meanY = y.reduce((a, b) => a + b, 0) / y.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < y.length; i++) {
    ssRes += (y[i] - predict(X[i])) ** 2;
    ssTot += (y[i] - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const rnd = mulberry32(opts.seed ?? 42);
  const draws: number[][] = Array.from({ length: beta.length }, () => []);
  for (let b = 0; b < iters; b++) {
    const bx: number[][] = [];
    const by: number[] = [];
    for (let i = 0; i < X.length; i++) {
      const k = Math.floor(rnd() * X.length);
      bx.push(X[k]);
      by.push(y[k]);
    }
    const fit = fitRidge(bx, by, lambda);
    if (!fit) continue;
    fit.forEach((v, i) => draws[i].push(v));
  }

  const ci = draws.map((d): [number, number] => {
    if (d.length < 10) return [Number.NaN, Number.NaN];
    const s = [...d].sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
    return [at(0.025), at(0.975)];
  });

  return { beta, ci, r2, n: X.length, lambda, bootstrap_iters: iters };
}

/** True when an interval spans zero — i.e. the effect is not distinguishable. */
export function crossesZero([lo, hi]: [number, number]): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true;
  return lo <= 0 && hi >= 0;
}
