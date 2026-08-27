/**
 * Audioscope keyboard shortcuts.
 *
 * Asserts that S toggles Static, K toggles Play/Pause, and [ / ] move focus
 * between mounted audioscope panes — while typing in form fields is never
 * hijacked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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
const compareEntities = [
  { id: "a", label: "A", color: "#14b8a6", scores },
  { id: "b", label: "B", color: "#f59e0b", scores },
];

const staticBtn = () => screen.getByTestId("scope").querySelector("#audioscope-static-toggle")!;

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  setReducedMotion(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("Audioscope keyboard shortcuts", () => {
  it("toggles Static with S when focus is inside the panel", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );

    const toggle = staticBtn() as HTMLButtonElement;
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    toggle.focus();

    await user.keyboard("s");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("s");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles playback with K and leaves Static", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const toggle = staticBtn() as HTMLButtonElement;
    toggle.focus();

    await user.keyboard("s");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("k");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();
  });

  it("does not hijack keystrokes typed into form fields", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const toggle = staticBtn() as HTMLButtonElement;

    const input = screen.getByLabelText("note");
    await user.click(input);
    await user.keyboard("sk");

    expect(input).toHaveValue("sk");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("moves focus between panes with ] and [", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );

    const single = document.querySelector("#audioscope-static-toggle") as HTMLButtonElement;
    const compare = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;

    single.focus();
    await user.keyboard("]");
    expect(document.activeElement).toBe(compare);

    await user.keyboard("[");
    expect(document.activeElement).toBe(single);
  });

  it("only toggles the pane that holds focus", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );

    const single = document.querySelector("#audioscope-static-toggle") as HTMLButtonElement;
    const compare = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;

    compare.focus();
    await user.keyboard("s");

    expect(compare).toHaveAttribute("aria-pressed", "true");
    expect(single).toHaveAttribute("aria-pressed", "false");
  });

  it("documents the shortcuts on screen for both panels", () => {
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const hints = screen.getAllByText(/S static/i);
    expect(hints.length).toBe(2);
    const scope = within(screen.getByTestId("scope"));
    expect(scope.getAllByText(/switch panes/i).length).toBe(2);
  });
});
