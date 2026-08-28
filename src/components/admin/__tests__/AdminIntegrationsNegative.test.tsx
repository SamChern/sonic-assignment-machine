// Negative-path integration tests for the admin APIs & MCPs tab and the EC2
// status panel: failed backend function calls, malformed sample-request input,
// and analysis API timeouts. All network calls are mocked.
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

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const getMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useEC2Api", () => ({ useEC2Api: () => ({ get: getMock }) }));
// `Ec2StatusPanel` embeds the semantic-service card, which runs its own health
// probes and renders its own "Checking…"/Refresh affordances. These tests cover
// the EC2 card only, so the nested panel is stubbed out.
vi.mock("@/components/admin/SemanticServicePanel", () => ({
  default: () => null,
}));


vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

import { IntegrationCrudCard } from "@/components/admin/IntegrationCrudCard";
import { AdminConnectedApisTab } from "@/components/admin/AdminConnectedApisTab";
import { Ec2StatusPanel } from "@/components/admin/Ec2StatusPanel";
import { INTEGRATIONS } from "@/config/integrations";

const appleMusic = INTEGRATIONS.find((i) => i.id === "apple_music")!;
const mcpGeneric = INTEGRATIONS.find((i) => i.id === "mcp_generic")!;
const librosaMcp = INTEGRATIONS.find((i) => i.kind === "mcp" && i.id !== "mcp_generic");

const clearMocks = () => {
  resetSupabaseMock();
  localStorage.clear();
  getMock.mockReset();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
};

const renderCard = (integration = appleMusic, props: Record<string, unknown> = {}) => {
  const onChanged = vi.fn();
  render(
    <IntegrationCrudCard
      integration={integration}
      statusLoading={false}
      onChanged={onChanged}
      {...props}
    />,
  );
  return { onChanged };
};

const openSettings = () => fireEvent.click(screen.getByText("Connection settings"));
const firstInput = () =>
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")[0];

describe("Admin integrations — failed backend function calls", () => {
  beforeEach(clearMocks);

  it("surfaces a transport-level save failure and keeps the entered value", async () => {
    onInvoke("admin-set-credentials", () => ({ error: { message: "network unreachable" } }));
    const { onChanged } = renderCard();
    openSettings();
    fireEvent.change(firstInput(), { target: { value: "REAL-TEAM-ID-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Save failed: network unreachable"),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect((firstInput() as HTMLInputElement).value).toBe("REAL-TEAM-ID-123");
  });

  it("surfaces a failed delete without clearing local state", async () => {
    onInvoke("admin-set-credentials", () => ({ error: { message: "delete rejected" } }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged } = renderCard(appleMusic, {
      status: { fields: [appleMusic.fields[0].key], updated_at: null },
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Delete failed: delete rejected"),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a transport error from the connection tester", async () => {
    onInvoke(appleMusic.testEndpoint!, () => ({ error: { message: "Edge Function returned 500" } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("500")),
    );
  });

  it("informs the user when a provider has no automated tester", async () => {
    const untested = INTEGRATIONS.find((i) => !i.testEndpoint);
    if (!untested) return; // registry currently ships testers for every provider
    renderCard(untested);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => expect(toastMock.info).toHaveBeenCalled());
    expect(invokeCalls).toHaveLength(0);
  });

  it("shows the error body when a sample request fails server-side", async () => {
    onInvoke("apple-music-search", () => ({ data: { success: false, error: "quota exceeded" } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /search apple music/i }));
    await waitFor(() => expect(screen.getByText(/quota exceeded/)).toBeInTheDocument());
  });

  it("shows the transport error when a sample request never reaches the provider", async () => {
    onInvoke("apple-music-search", () => ({ error: { message: "504 gateway timeout" } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /search apple music/i }));
    await waitFor(() => expect(screen.getByText(/504 gateway timeout/)).toBeInTheDocument());
  });

  it("explains when no sample preset exists for a REST provider", async () => {
    const noPreset = INTEGRATIONS.find(
      (i) => i.kind === "rest" && !["apple_music", "spotify", "librosa_rest"].includes(i.id),
    );
    if (!noPreset) return;
    renderCard(noPreset);
    fireEvent.click(screen.getByRole("button", { name: /sample request/i }));
    await waitFor(() =>
      expect(screen.getByText(/No sample request defined/)).toBeInTheDocument(),
    );
    expect(invokeCalls).toHaveLength(0);
  });
});

describe("Admin integrations — malformed sample-request input", () => {
  beforeEach(clearMocks);

  it("rejects invalid MCP JSON arguments before calling the backend", async () => {
    renderCard(mcpGeneric);
    fireEvent.change(screen.getByLabelText(/tool name/i), { target: { value: "get_activations" } });
    fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /call get_activations/i }));

    await waitFor(() =>
      expect(screen.getByText("Arguments must be valid JSON.")).toBeInTheDocument(),
    );
    expect(invokeCalls).toHaveLength(0);
  });

  it("treats blank arguments as an empty object", async () => {
    onInvoke("mcp-call", () => ({ data: { success: true, result: "ok" } }));
    renderCard(mcpGeneric);
    fireEvent.change(screen.getByLabelText(/tool name/i), { target: { value: "get_activations" } });
    fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /call get_activations/i }));

    await waitFor(() => expect(invokeCalls).toHaveLength(1));
    expect(invokeCalls[0].body).toMatchObject({ tool_name: "get_activations", arguments: {} });
  });

  it("surfaces upstream MCP DNS/tunnel failures in the response pane", async () => {
    onInvoke("mcp-call", () => ({
      error: { message: "Edge function returned 502: dns error: failed to lookup address" },
    }));
    renderCard(librosaMcp ?? mcpGeneric);
    fireEvent.click(screen.getByRole("button", { name: /list mcp tools/i }));
    await waitFor(() => expect(screen.getByText(/dns error/)).toBeInTheDocument());
  });

  it("keeps a placeholder MCP server URL from being saved", async () => {
    renderCard(mcpGeneric);
    openSettings();
    fireEvent.change(firstInput(), { target: { value: "https://mcp.example.com/sse" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("placeholder")),
    );
    expect(invokeCalls).toHaveLength(0);
  });
});

describe("Admin APIs & MCPs tab — degraded backend", () => {
  beforeEach(clearMocks);

  const renderTab = () =>
    render(
      <MemoryRouter>
        <AdminConnectedApisTab />
      </MemoryRouter>,
    );

  it("renders an empty Connected view when the status function errors", async () => {
    onInvoke("admin-get-credential-status", () => ({ error: { message: "500 boom" } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Connected \(0\)/)).toBeInTheDocument());
  });

  it("tolerates a malformed status payload", async () => {
    onInvoke("admin-get-credential-status", () => ({ data: { unexpected: true } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Connected \(0\)/)).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: /REST \(/ })).toBeInTheDocument();
  });
});

describe("Ec2StatusPanel — analysis API timeouts", () => {
  beforeEach(clearMocks);

  it("records a timeout in the health history and marks the service unreachable", async () => {
    getMock.mockResolvedValue({ data: null, error: "timeout of 30000ms exceeded" });
    render(<Ec2StatusPanel />);

    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
    expect(screen.getByText("timeout of 30000ms exceeded")).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("sonicsim.ec2.healthHistory") ?? "[]");
      expect(stored[0]).toMatchObject({ ok: false });
    });
  });

  it("treats a resolved-but-empty proxy response as unhealthy", async () => {
    getMock.mockResolvedValue({ data: null, error: null });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
  });

  it("keeps the panel usable while a slow probe is still pending", async () => {
    let resolveProbe: (v: unknown) => void = () => {};
    getMock.mockImplementation(
      () => new Promise((resolve) => { resolveProbe = resolve; }),
    );
    render(<Ec2StatusPanel />);

    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    resolveProbe({ data: { status: "healthy" }, error: null });
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });

  it("fails the reconnect when both probes time out", async () => {
    getMock.mockResolvedValue({ data: null, error: "timeout" });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Reconnect failed")),
    );
    expect(getMock).toHaveBeenCalledTimes(3);
  });
});
