// Role-based access control tests: only admins may create, update or delete
// API/MCP connection settings, run connection tests, or trigger EC2 actions.
// The mocked backend mirrors the server guard (`requireAdmin`): 401 for
// anonymous callers, 403 for signed-in non-admins.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  invokeCalls,
  resetSupabaseMock,
  supabaseMock,
} from "@/test/mocks/supabaseFunctions";
import { mockAdminGuard, type Role } from "@/test/mocks/roleAwareInvoke";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { IntegrationCrudCard } from "@/components/admin/IntegrationCrudCard";
import { Ec2StatusPanel } from "@/components/admin/Ec2StatusPanel";
import { INTEGRATIONS } from "@/config/integrations";

const appleMusic = INTEGRATIONS.find((i) => i.id === "apple_music")!;

const clearMocks = () => {
  resetSupabaseMock();
  localStorage.clear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
};

const renderCard = () => {
  const onChanged = vi.fn();
  render(
    <IntegrationCrudCard
      integration={appleMusic}
      status={{ fields: [appleMusic.fields[0].key], updated_at: null }}
      statusLoading={false}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
};

const openSettings = () => fireEvent.click(screen.getByText("Connection settings"));
const firstInput = () =>
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")[0];

describe.each<[Role, RegExp]>([
  ["anon", /401/],
  ["user", /403/],
  ["moderator", /403/],
])("IntegrationCrudCard RBAC — %s is denied", (role, expected) => {
  beforeEach(clearMocks);

  it("cannot create or update credentials", async () => {
    mockAdminGuard(role);
    const { onChanged } = renderCard();
    openSettings();
    fireEvent.change(firstInput(), { target: { value: "REAL-TEAM-ID-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(expected)),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("cannot delete stored credentials", async () => {
    mockAdminGuard(role);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged } = renderCard();
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(expected)),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("cannot run the connection test", async () => {
    mockAdminGuard(role);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(expected)),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("IntegrationCrudCard RBAC — admin is allowed", () => {
  beforeEach(clearMocks);

  it("saves, deletes and tests successfully", async () => {
    mockAdminGuard("admin", () => ({ data: { success: true, latency_ms: 12 } }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged } = renderCard();
    openSettings();
    fireEvent.change(firstInput(), { target: { value: "REAL-TEAM-ID-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Connection settings saved"),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Settings removed"));

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Connection OK")),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(invokeCalls.map((c) => c.fn)).toContain("admin-set-credentials");
  });
});

// The EC2 panel reaches the analysis API exclusively through the admin-guarded
// `aws-proxy` function; here the real hook runs against the mocked guard.
describe("EC2 RBAC — proxy guard", () => {
  beforeEach(clearMocks);

  it.each<[Role, RegExp]>([
    ["anon", /401/],
    ["user", /403/],
    ["moderator", /403/],
  ])("blocks %s from probing or reconnecting", async (role, expected) => {
    mockAdminGuard(role);
    render(<Ec2StatusPanel />);

    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
    expect(screen.getByText(expected)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Reconnect failed")),
    );
    expect(invokeCalls.every((c) => c.fn === "aws-proxy")).toBe(true);
  });

  it("lets an admin probe and reconnect", async () => {
    mockAdminGuard("admin", () => ({ data: { status: "healthy", region: "us-east-1" } }));
    render(<Ec2StatusPanel />);

    await waitFor(() => expect(screen.getByText("us-east-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Reconnected to the EC2 analysis API"),
    );
  });
});
