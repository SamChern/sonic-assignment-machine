/**
 * Audioscope reduced-motion / Static behavior.
 *
 * The SonicSIM panel no longer exposes a Static toggle, Play/Pause controls,
 * or a speed selector (product decision) — it only offers the visualization
 * mode buttons now. The dual "compare" audioscope still has the full Static /
 * Play / speed transport, so this file asserts:
 *  - with prefers-reduced-motion: reduce, the compare panel opens in Static
 *    and shows the accessibility explanation,
 *  - clicking Play leaves Static and starts motion,
 *  - the choice persists across remounts (page loads),
 *  - without reduced motion, the panel opens in motion with no notice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const staticBtn = () => screen.getByRole("button", { name: /static/i });

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  // Canvas 2D isn't implemented in jsdom; the renderer bails out safely on null.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
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
    expect(screen.getByRole("note")).toHaveTextContent(/reduced motion is on/i);
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

  it("starts animating with no reduced-motion notice when the setting is off", () => {
    setReducedMotion(false);
    render(<AudioscopeCompare entities={compareEntities} />);

    expect(staticBtn()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
