// End-to-end style test of the admin "APIs & MCPs" tab: status loading,
// Connected / REST / MCP views, and CRUD wiring against mocked backend calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  invokeCalls,
  onInvoke,
  resetSupabaseMock,
  supabaseMock,
} from "@/test/mocks/supabaseFunctions";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { AdminConnectedApisTab } from "@/components/admin/AdminConnectedApisTab";
import { INTEGRATIONS } from "@/config/integrations";

const appleMusic = INTEGRATIONS.find((i) => i.id === "apple_music")!;

const statusPayload = {
  status: {
    apple_music: {
      fields: appleMusic.fields.map((f) => f.key),
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  },
  lastTest: {
    apple_music: {
      integration_id: "apple_music",
      success: true,
      latency_ms: 140,
      error_message: null,
      tested_at: "2026-08-02T00:00:00.000Z",
    },
  },
};

const renderTab = () =>
  render(
    <MemoryRouter>
      <AdminConnectedApisTab />
    </MemoryRouter>,
  );

describe("AdminConnectedApisTab", () => {
  beforeEach(() => {
    resetSupabaseMock();
    navigateMock.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
  });

  it("loads credential status on mount and counts verified integrations", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    renderTab();

    await waitFor(() =>
      expect(invokeCalls.some((c) => c.fn === "admin-get-credential-status")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText(/Connected \(1\)/)).toBeInTheDocument());
  });

  it("lists REST integrations with CRUD cards", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/REST \(/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/REST \(/));
    await waitFor(() => expect(screen.getByText(appleMusic.name)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /test connection/i }).length).toBeGreaterThan(0);
  });

  it("lists MCP integrations in the MCP view", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/MCP \(/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/MCP \(/));
    const mcpNames = INTEGRATIONS.filter((i) => i.kind === "mcp").map((i) => i.name);
    await waitFor(() => expect(screen.getByText(mcpNames[0])).toBeInTheDocument());
  });

  it("refetches status after a CRUD change inside a card", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    onInvoke(appleMusic.testEndpoint!, () => ({ data: { success: true, latency_ms: 10 } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/REST \(/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/REST \(/));
    await waitFor(() => expect(screen.getByText(appleMusic.name)).toBeInTheDocument());

    const before = invokeCalls.filter((c) => c.fn === "admin-get-credential-status").length;
    fireEvent.click(screen.getAllByRole("button", { name: /test connection/i })[0]);
    await waitFor(() =>
      expect(
        invokeCalls.filter((c) => c.fn === "admin-get-credential-status").length,
      ).toBeGreaterThan(before),
    );
  });

  it("re-runs the status fetch when Refresh is pressed", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    renderTab();
    await waitFor(() => expect(invokeCalls).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(invokeCalls).toHaveLength(2));
  });

  it("navigates to the full setup page", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: statusPayload }));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /full setup page/i }));
    expect(navigateMock).toHaveBeenCalledWith("/admin/integrations");
  });

  it("tolerates a failed status fetch without crashing", async () => {
    onInvoke("admin-get-credential-status", () => ({ error: { message: "no access" } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Connected \(0\)/)).toBeInTheDocument());
  });
});
