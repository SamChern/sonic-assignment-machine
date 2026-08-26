// Integration tests for the admin API/MCP CRUD card: create/update, delete,
// connection test, and sample request validation — all with mocked backend calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  invokeCalls,
  onInvoke,
  resetSupabaseMock,
  supabaseMock,
} from "@/test/mocks/supabaseFunctions";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};
vi.mock("sonner", () => ({ toast: toastMock }));

import { IntegrationCrudCard } from "@/components/admin/IntegrationCrudCard";
import { INTEGRATIONS } from "@/config/integrations";

const appleMusic = INTEGRATIONS.find((i) => i.id === "apple_music")!;
const mcpGeneric = INTEGRATIONS.find((i) => i.id === "mcp_generic")!;

const renderCard = (props: Partial<Parameters<typeof IntegrationCrudCard>[0]> = {}) => {
  const onChanged = vi.fn();
  const utils = render(
    <IntegrationCrudCard
      integration={appleMusic}
      statusLoading={false}
      onChanged={onChanged}
      {...props}
    />,
  );
  return { ...utils, onChanged };
};

const openSettings = () => fireEvent.click(screen.getByText("Connection settings"));

const firstTextInput = () => {
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  return inputs[0];
};

describe("IntegrationCrudCard — CRUD flows", () => {
  beforeEach(() => {
    resetSupabaseMock();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    toastMock.info.mockClear();
  });

  it("shows 'Not configured' when no credentials are stored", () => {
    renderCard();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("shows 'Verified' when the last test succeeded", () => {
    renderCard({
      status: { fields: appleMusic.fields.map((f) => f.key), updated_at: null },
      lastTest: {
        integration_id: appleMusic.id,
        success: true,
        latency_ms: 120,
        error_message: null,
        tested_at: new Date().toISOString(),
      },
    });
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("rejects an empty save without calling the backend", async () => {
    renderCard();
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(invokeCalls).toHaveLength(0);
  });

  it("rejects placeholder values", async () => {
    renderCard();
    openSettings();
    fireEvent.change(firstTextInput(), { target: { value: "https://example.com/key" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("placeholder")),
    );
    expect(invokeCalls).toHaveLength(0);
  });

  it("saves credentials through admin-set-credentials", async () => {
    onInvoke("admin-set-credentials", () => ({ data: { success: true } }));
    const { onChanged } = renderCard();
    openSettings();
    fireEvent.change(firstTextInput(), { target: { value: "REAL-TEAM-ID-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Connection settings saved"));
    expect(invokeCalls[0].fn).toBe("admin-set-credentials");
    expect(invokeCalls[0].body).toMatchObject({ integration_id: "apple_music" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("surfaces backend errors returned in the payload", async () => {
    onInvoke("admin-set-credentials", () => ({ data: { error: "forbidden" } }));
    renderCard();
    openSettings();
    fireEvent.change(firstTextInput(), { target: { value: "REAL-TEAM-ID-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Save failed: forbidden"),
    );
  });

  it("deletes all stored settings after confirmation", async () => {
    onInvoke("admin-set-credentials", () => ({ data: { success: true } }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged } = renderCard({
      status: { fields: [appleMusic.fields[0].key], updated_at: null },
    });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Settings removed"));
    expect(invokeCalls[0].body).toMatchObject({
      integration_id: "apple_music",
      action: "delete",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("deletes a single stored field", async () => {
    onInvoke("admin-set-credentials", () => ({ data: { success: true } }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ status: { fields: [appleMusic.fields[0].key], updated_at: null } });
    openSettings();
    fireEvent.click(screen.getAllByText(/stored — remove/)[0]);
    await waitFor(() => expect(invokeCalls).toHaveLength(1));
    expect(invokeCalls[0].body).toMatchObject({
      action: "delete",
      field_keys: [appleMusic.fields[0].key],
    });
  });

  it("aborts the delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard({ status: { fields: [appleMusic.fields[0].key], updated_at: null } });
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    await waitFor(() => expect(invokeCalls).toHaveLength(0));
  });
});

describe("IntegrationCrudCard — testing & sample requests", () => {
  beforeEach(() => {
    resetSupabaseMock();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    toastMock.info.mockClear();
  });

  it("reports a successful connection test with latency", async () => {
    onInvoke(appleMusic.testEndpoint!, () => ({ data: { success: true, latency_ms: 88 } }));
    const { onChanged } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Connection OK (88ms)"));
    expect(invokeCalls[0].fn).toBe(appleMusic.testEndpoint);
    expect(onChanged).toHaveBeenCalled();
  });

  it("reports a failed connection test", async () => {
    onInvoke(appleMusic.testEndpoint!, () => ({ data: { success: false, error: "bad token" } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("bad token")),
    );
  });

  it("runs the REST sample request preset and renders the response", async () => {
    onInvoke("apple-music-search", () => ({ data: { success: true, results: ["one"] } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /search apple music/i }));
    await waitFor(() => expect(screen.getByText(/"results"/)).toBeInTheDocument());
    expect(invokeCalls[0]).toMatchObject({
      fn: "apple-music-search",
      body: { query: "daft punk", limit: 3 },
    });
  });

  it("lists MCP tools when no tool name is given", async () => {
    onInvoke("mcp-call", () => ({ data: { success: true, tools: [{ name: "get_activations" }] } }));
    renderCard({ integration: mcpGeneric });
    fireEvent.click(screen.getByRole("button", { name: /list mcp tools/i }));
    await waitFor(() => expect(screen.getByText(/get_activations/)).toBeInTheDocument());
    expect(invokeCalls[0].body).toMatchObject({
      integration_id: mcpGeneric.id,
      list_tools: true,
    });
  });

  it("calls a named MCP tool with parsed JSON arguments", async () => {
    onInvoke("mcp-call", () => ({ data: { success: true, result: "ok" } }));
    renderCard({ integration: mcpGeneric });
    fireEvent.change(screen.getByLabelText(/tool name/i), {
      target: { value: "get_activation" },
    });
    fireEvent.change(screen.getByLabelText(/arguments/i), {
      target: { value: '{"id":"5514"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /call get_activation/i }));
    await waitFor(() => expect(invokeCalls).toHaveLength(1));
    expect(invokeCalls[0].body).toMatchObject({
      tool_name: "get_activation",
      arguments: { id: "5514" },
    });
  });

  it("blocks invalid MCP JSON arguments before invoking the function", async () => {
    renderCard({ integration: mcpGeneric });
    fireEvent.change(screen.getByLabelText(/tool name/i), { target: { value: "get_activation" } });
    fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: "{nope" } });
    fireEvent.click(screen.getByRole("button", { name: /call get_activation/i }));
    await waitFor(() =>
      expect(screen.getByText("Arguments must be valid JSON.")).toBeInTheDocument(),
    );
    expect(invokeCalls).toHaveLength(0);
  });

  it("renders an error block when the sample request fails", async () => {
    onInvoke("apple-music-search", () => ({ data: { success: false, error: "rate limited" } }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /search apple music/i }));
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
  });
});
