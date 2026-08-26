// Integration tests for the admin EC2 status panel: health probing via the
// mocked analysis API, detail rendering, history persistence, refresh, reconnect.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useEC2Api", () => ({
  useEC2Api: () => ({ get: getMock }),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { Ec2StatusPanel } from "@/components/admin/Ec2StatusPanel";

const HISTORY_KEY = "sonicsim.ec2.healthHistory";

const healthy = {
  data: {
    status: "healthy",
    region: "us-east-1",
    instance_id: "i-0abc123",
    hostname: "librosa-1",
    instance_type: "t3.large",
    version: "1.4.2",
    uptime: "3d 4h",
  },
  error: null,
};

describe("Ec2StatusPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
  });

  it("probes the health endpoint on mount and renders instance details", async () => {
    getMock.mockResolvedValue(healthy);
    render(<Ec2StatusPanel />);

    await waitFor(() => expect(screen.getByText("us-east-1")).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith("/api/health");
    expect(screen.getByText("i-0abc123")).toBeInTheDocument();
    expect(screen.getByText("librosa-1")).toBeInTheDocument();
    expect(screen.getByText("t3.large")).toBeInTheDocument();
    expect(screen.getByText("1.4.2")).toBeInTheDocument();
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
  });

  it("shows 'not reported' for details the API omits", async () => {
    getMock.mockResolvedValue({ data: { status: "ok" }, error: null });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(screen.getAllByText("not reported").length).toBe(6));
  });

  it("marks the service unreachable when the proxy errors", async () => {
    getMock.mockResolvedValue({ data: null, error: "connection refused" });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("persists health checks to local storage, capped at 10", async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({
          at: new Date(2026, 0, i + 1).toISOString(),
          ok: true,
          latency_ms: i,
          detail: "healthy",
        })),
      ),
    );
    getMock.mockResolvedValue(healthy);
    render(<Ec2StatusPanel />);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
      expect(stored).toHaveLength(10);
      expect(stored[0].detail).toBe("healthy");
    });
  });

  it("re-probes on Refresh and announces the result", async () => {
    getMock.mockResolvedValue(healthy);
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/EC2 healthy/)));
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("announces a failed manual refresh", async () => {
    getMock.mockResolvedValue({ data: null, error: "timeout" });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("EC2 check failed: timeout"),
    );
  });

  it("reconnect probes twice and reports success if either probe succeeds", async () => {
    getMock
      .mockResolvedValueOnce(healthy) // mount
      .mockResolvedValueOnce({ data: null, error: "reset" })
      .mockResolvedValueOnce(healthy);
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Reconnected to the EC2 analysis API"),
    );
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it("reports a failed reconnect when both probes fail", async () => {
    getMock.mockResolvedValue({ data: null, error: "unreachable" });
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Reconnect failed")),
    );
  });

  it("recovers gracefully from corrupt stored history", async () => {
    localStorage.setItem(HISTORY_KEY, "not json");
    getMock.mockResolvedValue(healthy);
    render(<Ec2StatusPanel />);
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });
});
