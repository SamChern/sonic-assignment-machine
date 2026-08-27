/**
 * Audioscope reduced-motion / Static behavior.
 *
 * Runs in CI (`npm run test`) and asserts:
 *  - with prefers-reduced-motion: reduce, the panel opens in Static and shows the
 *    accessibility explanation,
 *  - clicking Play leaves Static and starts motion,
 *  - the choice persists across remounts (page loads),
 *  - without reduced motion, the panel opens in motion with no notice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SonicSimPanel from "@/components/visuals/SonicSimPanel";
import AudioscopeCompare from "@/components/visuals/AudioscopeCompare";
import { AUDIOSCOPE_CATEGORIES, type CategoryScores } from "@/lib/audioscope";

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const scores = AUDIOSCOPE_CATEGORIES.reduce((acc, c, i) => {
  acc[c] = 40 + i * 8;
  return acc;
}, {} as CategoryScores);

const subjects = [{ id: "fp-1", label: "My sonic fingerprint", scores }];

const staticBtn = () => screen.getByRole("button", { name: /static/i });

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  // Canvas 2D isn't implemented in jsdom; the renderer bails out safely on null.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("Audioscope Static mode", () => {
  it("defaults to Static and explains why when prefers-reduced-motion is set", () => {
    setReducedMotion(true);
    render(<SonicSimPanel subjects={subjects} />);

    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^play\b/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/reduced motion is on/i);
    expect(screen.getByText(/Static frame/i)).toBeInTheDocument();
  });

  it("switches out of Static when Play is clicked", async () => {
    setReducedMotion(true);
    render(<SonicSimPanel subjects={subjects} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^play\b/i }));

    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();
  });

  it("remembers the Play choice across page loads", async () => {
    setReducedMotion(true);
    const first = render(<SonicSimPanel subjects={subjects} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^play\b/i }));
    first.unmount();

    render(<SonicSimPanel subjects={subjects} />);
    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
  });

  it("remembers an explicit Static choice when reduced motion is off", async () => {
    setReducedMotion(false);
    const first = render(<SonicSimPanel subjects={subjects} />);
    const user = userEvent.setup();
    await user.click(staticBtn());
    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
    first.unmount();

    render(<SonicSimPanel subjects={subjects} />);
    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
  });

  it("starts animating with no reduced-motion notice when the setting is off", () => {
    setReducedMotion(false);
    render(<SonicSimPanel subjects={subjects} />);

    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

const compareEntities = [
  { id: "a", label: "Subject A", color: "#14b8a6", scores },
  { id: "b", label: "Subject B", color: "#f97316", scores },
];

describe("Dual audioscope Static parity", () => {
  it("defaults to Static under reduced motion and explains it", () => {
    setReducedMotion(true);
    render(<AudioscopeCompare entities={compareEntities} similarity={72} />);

    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^play\b/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/reduced motion is on/i);
  });

  it("Play leaves Static and Static halts motion, persisting the choice", async () => {
    setReducedMotion(true);
    const user = userEvent.setup();
    const first = render(<AudioscopeCompare entities={compareEntities} />);

    await user.click(screen.getByRole("button", { name: /^play\b/i }));
    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();

    await user.click(staticBtn());
    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^play\b/i })).toBeInTheDocument();
    first.unmount();

    render(<AudioscopeCompare entities={compareEntities} />);
    expect(staticBtn()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps its own preference separate from the SonicSIM panel", async () => {
    setReducedMotion(false);
    const user = userEvent.setup();
    const first = render(<AudioscopeCompare entities={compareEntities} />);
    await user.click(staticBtn());
    first.unmount();

    render(<SonicSimPanel subjects={subjects} />);
    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
  });
});
