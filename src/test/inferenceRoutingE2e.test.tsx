/**
 * End-to-end: semantic processing with Lovable AI routing is never blocked
 * while EC2_INFERENCE_REQUIRED is false.
 *
 * "End-to-end" here means the real chain runs: the production verdict logic
 * from the edge function (`parseInferenceConfig` + `buildVerdict`) answers the
 * `inference-config-validate` invocation, the real `useInferenceReadiness`
 * hook consumes that response, the real `InferenceConfigGuard` renders it, and
 * the real admin wizard decides whether the "Run semantic processing" button
 * is clickable — then we click it and assert the pipeline actually starts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  buildVerdict,
  parseInferenceConfig,
  type ProbeResult,
} from "../../supabase/functions/_shared/inferenceVerdict";

/** Production env shape today: EC2 serves embeddings, scoring is on Lovable AI. */
const LOVABLE_AI_ROUTING_ENV: Record<string, string> = {
  EC2_INFERENCE_URL: "https://ec2.example.com",
  EC2_INFERENCE_API_KEY: "ec2-key",
  EC2_EMBEDDING_MODEL: "nomic-embed-text:latest",
  EC2_EMBEDDING_DIMS: "768",
  // EC2_INFERENCE_MODEL intentionally unset — scoring runs on Lovable AI.
  EC2_INFERENCE_REQUIRED: "false",
  LOVABLE_API_KEY: "lovable-key",
};

/** CPU-only EC2 box serving only the embedding model. */
const CPU_PROBE: ProbeResult = {
  reachable: true,
  reachableDetail: "Serving 1 model(s)",
  servedModels: ["nomic-embed-text:latest"],
  gpu: false,
};

const invoked: { name: string; body: unknown }[] = [];
let env: Record<string, string> = { ...LOVABLE_AI_ROUTING_ENV };
let probe: ProbeResult = CPU_PROBE;

/** Serves each edge function call the way the deployed functions would. */
const invoke = vi.fn(async (name: string, opts?: { body?: unknown }) => {
  invoked.push({ name, body: opts?.body });

  if (name === "inference-config-validate") {
    // Exactly what supabase/functions/inference-config-validate/index.ts returns.
    return { data: { success: true, ...buildVerdict(parseInferenceConfig(env), probe) }, error: null };
  }
  if (name === "intuizi-ingest") {
    const body = (opts?.body ?? {}) as { action?: string };
    if (body.action === "activations") {
      return {
        data: {
          activations: [
            {
              activation_id: "5580",
              files: [
                {
                  object_key: "inbound/20260827_web_report_activation_id5580.csv",
                  report_type: "ctv",
                  size: 2048,
                  prefix: "inbound/",
                  status: "done",
                  total_rows: 100,
                  processed_rows: 100,
                  finished_at: new Date().toISOString(),
                  error_message: null,
                },
              ],
              empty_files: 0,
              total_bytes: 2048,
              done_files: 1,
            },
          ],
        },
        error: null,
      };
    }
    return { data: { files_processed: 1, identifiers_upserted: 100 }, error: null };
  }
  // Any remaining pipeline step (scoring, linkage, etc.).
  return { data: { success: true }, error: null };
});

// Chainable query-builder stub: every method returns the same builder, and the
// builder resolves to an empty result, so any query shape the wizard uses
// (select/eq/order/limit/maybeSingle/single/in/...) works without extra mocks.
const emptyResult = { data: null, error: null };
const queryBuilder: Record<string, unknown> = {
  then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  maybeSingle: async () => emptyResult,
  single: async () => emptyResult,
};
for (const method of ["select", "eq", "neq", "in", "order", "limit", "range", "filter", "insert", "update", "upsert", "delete", "not", "is", "gte", "lte", "contains", "or", "match"]) {
  queryBuilder[method] = () => queryBuilder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...(args as [string, { body?: unknown }])) },
    from: () => queryBuilder,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));


vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

import PostIngestionWizard from "@/components/PostIngestionWizard";

const runButton = () => screen.getByRole("button", { name: /run semantic processing/i });

describe("E2E: semantic processing with Lovable AI routing", () => {
  beforeEach(() => {
    invoked.length = 0;
    invoke.mockClear();
    env = { ...LOVABLE_AI_ROUTING_ENV };
    probe = CPU_PROBE;
  });

  it("validates configuration on mount and never blocks the run action", async () => {
    render(<PostIngestionWizard />);

    await waitFor(() =>
      expect(invoked.some((c) => c.name === "inference-config-validate")).toBe(true),
    );

    // Guard reports the intentional routing, not a warning about missing GPU.
    await waitFor(() =>
      expect(screen.getAllByText(/scoring on Lovable AI/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/runs on Lovable AI \(intentional\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/no GPU detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Semantic processing blocked/i)).not.toBeInTheDocument();

    // The run action is not gated by the validator (only by activation selection).
    const verdict = buildVerdict(parseInferenceConfig(env), probe);
    expect(verdict.blocked).toBe(false);
    expect(verdict.chat_provider).toBe("gateway");
  });

  it("runs the pipeline end to end once an activation is selected", async () => {
    const user = userEvent.setup();
    render(<PostIngestionWizard />);

    await waitFor(() =>
      expect(invoked.some((c) => c.name === "inference-config-validate")).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: /find activations/i }));
    await waitFor(() => expect(runButton()).toBeEnabled());

    await user.click(runButton());

    // Semantic processing actually started — it was never blocked.
    await waitFor(() =>
      expect(invoked.filter((c) => c.name !== "inference-config-validate").length).toBeGreaterThan(1),
    );
  });

  it("stays unblocked when EC2 is unreachable, since scoring is on Lovable AI", async () => {
    probe = { reachable: false, reachableDetail: "Probe failed", servedModels: [], gpu: null };
    render(<PostIngestionWizard />);

    await waitFor(() =>
      expect(screen.getAllByText(/scoring on Lovable AI/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Semantic processing blocked/i)).not.toBeInTheDocument();
    expect(buildVerdict(parseInferenceConfig(env), probe).blocked).toBe(false);
  });

  it.each(["false", "0", "", "no", "maybe"])(
    "is never blocked with EC2_INFERENCE_REQUIRED=%s",
    (value) => {
      const verdict = buildVerdict(
        parseInferenceConfig({ ...LOVABLE_AI_ROUTING_ENV, EC2_INFERENCE_REQUIRED: value }),
        CPU_PROBE,
      );
      expect(verdict.blocked).toBe(false);
      expect(verdict.chat_provider).toBe("gateway");
    },
  );

  it("blocks only when EC2_INFERENCE_REQUIRED=true with a hard failure", () => {
    const verdict = buildVerdict(
      parseInferenceConfig({ ...LOVABLE_AI_ROUTING_ENV, EC2_INFERENCE_REQUIRED: "true" }),
      CPU_PROBE,
    );
    expect(verdict.blocked).toBe(true);
  });
});
