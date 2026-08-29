// Ridge fitting on the EC2 semantic worker, with the in-process estimator as
// the fallback (Step 11c rule 1).
//
// Shared by `predict-outcomes` (one fit per run) and `activation-lift` (one fit
// per axis, the heavier job) so both report the same numbers and the same
// engine label. Any remote failure — unreachable worker, bad shape, timeout —
// degrades to the identical local estimator rather than failing the request.

import { fitRidgeWithBootstrap, type RidgeFit } from "./ridge.ts";
import { getSemanticSvcConfig } from "./semanticSvc.ts";

export const RIDGE_LAMBDA = 1e-2;

export type FitEngine = "ec2" | "edge";

export interface RemoteFitResult {
  fit: RidgeFit;
  engine: FitEngine;
}

/**
 * Fit `y ~ X` with ridge + bootstrap CIs. Returns null when even the local
 * estimator cannot fit (collinear or degenerate design matrix), so per-axis
 * callers can skip an axis instead of failing the whole run.
 */
export async function fitRemoteOrLocal(
  // deno-lint-ignore no-explicit-any
  admin: any,
  X: number[][],
  y: number[],
  iters: number,
  opts: { lambda?: number; timeoutMs?: number } = {},
): Promise<RemoteFitResult | null> {
  const lambda = opts.lambda ?? RIDGE_LAMBDA;
  const cfg = await getSemanticSvcConfig(admin);

  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/fit_ridge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.token}`,
        },
        body: JSON.stringify({ X, y, lambda, bootstrap_iters: iters }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (res.ok) {
        const b = await res.json();
        if (Array.isArray(b?.beta) && Array.isArray(b?.ci)) {
          return {
            fit: {
              beta: b.beta.map(Number),
              ci: b.ci.map((c: number[]) => [Number(c[0]), Number(c[1])] as [number, number]),
              r2: Number(b.r2 ?? 0),
              n: X.length,
              lambda,
              bootstrap_iters: Number(b.bootstrap_iters ?? iters),
            },
            engine: "ec2",
          };
        }
      }
    } catch (e) {
      console.warn("ridge fit on EC2 unavailable:", e instanceof Error ? e.message : e);
    }
  }

  const fit = fitRidgeWithBootstrap(X, y, { lambda, iters });
  return fit ? { fit, engine: "edge" } : null;
}
