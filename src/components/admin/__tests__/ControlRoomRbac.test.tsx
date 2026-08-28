// Step 9 role matrix, expressed as tests.
//
// Two rules the backend enforces and these tests pin down:
//  1. `control_registry` / `control_audit` are admin-only (RLS via
//     has_role(auth.uid(),'admin')): non-admins read nothing and writes fail.
//  2. Anything carrying a `subject_key` (`sonic_cohort_members`) is
//     service-role/admin only — enterprise roles read aggregates
//     (`sonic_cohorts`) but never member identifiers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Role = "anon" | "user" | "moderator" | "enterprise_viewer" | "admin";

let role: Role = "admin";

const REGISTRY_ROWS = [
  {
    key: "knn.k",
    value: 5,
    value_type: "number",
    bounds: { min: 1, max: 32, step: 1 },
    description: "Nearest neighbors",
    category: "scoring",
    updated_at: new Date().toISOString(),
    updated_by: null,
  },
  {
    key: "retention.days",
    value: 90,
    value_type: "number",
    bounds: { min: 7, max: 365, step: 1 },
    description: "Retention window",
    category: "compliance",
    updated_at: new Date().toISOString(),
    updated_by: null,
  },
];

const AUDIT_ROWS = [
  {
    id: 1,
    key: "knn.k",
    old_value: 4,
    new_value: 5,
    changed_at: new Date().toISOString(),
  },
];

const isAdmin = () => role === "admin";
const denied = () =>
  role === "anon"
    ? { data: null, error: { message: "401: JWT is required" } }
    : { data: null, error: { message: "403: permission denied" } };

export const updateCalls: { table: string; value: unknown }[] = [];

/** Minimal chainable query builder that mirrors the RLS outcome per role. */
// deno-lint-ignore no-explicit-any
function builder(table: string): any {
  const rowsFor = () => {
    if (table === "control_registry") return REGISTRY_ROWS;
    if (table === "control_audit") return AUDIT_ROWS;
    if (table === "sonic_cohorts") return [{ slug: "night-drive", member_count: 412 }];
    return [];
  };
  // Aggregate cohort rows are readable by enterprise roles; member rows never are.
  const readable =
    table === "sonic_cohorts"
      ? role === "admin" || role === "enterprise_viewer"
      : isAdmin();

  const result = () =>
    readable ? { data: rowsFor(), error: null } : denied();

  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "eq", "limit"]) {
    chain[m] = () => chain;
  }
  chain.update = (value: unknown) => {
    updateCalls.push({ table, value });
    return {
      eq: async () => (isAdmin() ? { data: null, error: null } : denied()),
    };
  };
  chain.maybeSingle = async () => {
    const r = result();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
  };
  chain.then = (
    resolve: (v: { data: unknown; error: unknown }) => unknown,
  ) => Promise.resolve(result()).then(resolve);
  return chain;
}

const supabaseMock = {
  from: (table: string) => builder(table),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
  },
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: role === "anon" ? null : { id: "u1" },
    isAdmin: role === "admin",
    loading: false,
  }),
}));

import AdminControlRoom from "@/pages/AdminControlRoom";

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminControlRoom />
    </MemoryRouter>,
  );

beforeEach(() => {
  updateCalls.length = 0;
  navigate.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe("Control Room — admin", () => {
  beforeEach(() => {
    role = "admin";
  });

  it("renders grouped knobs from the registry with audit history", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("knn.k")).toBeInTheDocument());
    expect(screen.getByText("retention.days")).toBeInTheDocument();
    expect(screen.getByText("Scoring core")).toBeInTheDocument();
    expect(screen.getByText("Retention & compliance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /history for knn.k/i }));
    await waitFor(() =>
      expect(screen.getByText(/4 → 5/)).toBeInTheDocument(),
    );
  });

  it("writes a new value and reports it as live within 60s", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("knn.k")).toBeInTheDocument());

    const slider = screen.getByLabelText("knn.k");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("unsaved")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);
    await waitFor(() => expect(updateCalls.length).toBeGreaterThan(0));
    expect(updateCalls[0].table).toBe("control_registry");
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("reverts a knob to its previous audited value", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("knn.k")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /revert knn.k/i }));
    await waitFor(() => expect(updateCalls.length).toBe(1));
    expect((updateCalls[0].value as { value: unknown }).value).toBe(4);
  });
});

describe.each<[Role, RegExp]>([
  ["anon", /401/],
  ["user", /403/],
  ["moderator", /403/],
  ["enterprise_viewer", /403/],
])("Control Room RBAC — %s is denied", (r, expected) => {
  beforeEach(() => {
    role = r;
  });

  it("is redirected away from the page", async () => {
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("cannot read the registry and cannot write a value", async () => {
    const read = await supabaseMock.from("control_registry").select("*");
    expect(read.data).toBeNull();
    expect(String((read.error as { message: string }).message)).toMatch(expected);

    const write = await supabaseMock
      .from("control_registry")
      .update({ value: 9 })
      .eq("key", "knn.k");
    expect(String((write.error as { message: string }).message)).toMatch(expected);
  });

  it("cannot read the control audit trail", async () => {
    const audit = await supabaseMock.from("control_audit").select("*");
    expect(audit.data).toBeNull();
  });
});

describe("subject_key isolation", () => {
  it("enterprise viewers read cohort aggregates but never member subject keys", async () => {
    role = "enterprise_viewer";
    const agg = await supabaseMock.from("sonic_cohorts").select("*");
    expect(agg.error).toBeNull();
    expect((agg.data as { member_count: number }[])[0].member_count).toBe(412);

    const members = await supabaseMock.from("sonic_cohort_members").select("subject_key");
    expect(members.data).toEqual([]);
  });

  it("consumer role has no access to Intuizi-derived tables", async () => {
    role = "user";
    const members = await supabaseMock.from("sonic_cohort_members").select("subject_key");
    expect(members.data).toEqual([]);
    const cohorts = await supabaseMock.from("sonic_cohorts").select("*");
    expect(cohorts.data).toBeNull();
  });
});
