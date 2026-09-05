/**
 * Audioscope keyboard shortcuts.
 *
 * The SonicSIM panel dropped its Static toggle, Play/Pause controls, speed
 * selector, and presentation toggle (product decision) — it keeps only the
 * visualization mode buttons. It still wires up S / K internally (announced
 * via the sr-only live region) and still owns the keystroke while focus is
 * inside it, but it is no longer a focus-cycling "pane" (it has no anchor
 * element), so `]` / `[` / `M` pane-jumping is now exercised through the dual
 * "compare" audioscope, which keeps its full transport UI.
 *
 * This asserts:
 *  - S / K still toggle Static / Play state inside the SonicSIM panel
 *    (visible via the sr-only status announcement),
 *  - typing in form fields is never hijacked,
 *  - `]` / `[` move focus between compare panes, and M jumps to motion
 *    controls,
 *  - the SonicSIM panel's reduced-motion notice still advertises M,
 *  - the visualization mode buttons still switch modes.
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

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  setReducedMotion(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("Audioscope keyboard shortcuts", () => {
  it("toggles Static and playback with S and K while focus is inside the SonicSIM panel", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const status = document.querySelector("#audioscope-status") as HTMLElement;
    const modeBtn = screen.getByRole("button", { name: "Scope" }) as HTMLButtonElement;
    modeBtn.focus();

    expect(status.textContent).toMatch(/animating/i);

    await user.keyboard("s");
    expect(status.textContent).toMatch(/static — one frame at 1\.25 seconds/i);

    await user.keyboard("k");
    expect(status.textContent).toMatch(/animating at 1x speed/i);

    await user.keyboard("k");
    expect(status.textContent).toMatch(/paused/i);
  });

  it("does not hijack keystrokes typed into form fields", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const status = document.querySelector("#audioscope-status") as HTMLElement;
    const before = status.textContent;

    const input = screen.getByLabelText("note");
    await user.click(input);
    await user.keyboard("sk");

    expect(input).toHaveValue("sk");
    expect(status.textContent).toBe(before);
  });

  it("switches the visualization mode when the mode buttons are clicked", async () => {
    const user = userEvent.setup();
    render(<SonicSimPanel subjects={subjects} modes={["scope", "radial", "nodes"]} />);

    const scopeBtn = screen.getByRole("button", { name: "Scope" });
    const nodesBtn = screen.getByRole("button", { name: "Node pulse" });

    expect(scopeBtn.className).not.toMatch(/bg-primary/);

    await user.click(scopeBtn);
    expect(scopeBtn.className).toMatch(/bg-primary/);
    expect(nodesBtn.className).not.toMatch(/bg-primary/);

    await user.click(nodesBtn);
    expect(nodesBtn.className).toMatch(/bg-primary/);
    expect(scopeBtn.className).not.toMatch(/bg-primary/);
  });

  it("moves focus between compare panes with ] and [", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <AudioscopeCompare entities={compareEntities} similarity={72} />
        <AudioscopeCompare entities={compareEntities} similarity={40} />
      </div>,
    );

    const anchors = document.querySelectorAll("#audioscope-compare-static-toggle");
    const [first, second] = Array.from(anchors) as HTMLButtonElement[];

    first.focus();
    await user.keyboard("]");
    expect(document.activeElement).toBe(second);

    await user.keyboard("[[");
    expect(document.activeElement).toBe(first);
  });

  it("only toggles the compare pane that holds focus", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <AudioscopeCompare entities={compareEntities} similarity={72} />
        <AudioscopeCompare entities={compareEntities} similarity={40} />
      </div>,
    );

    const [first, second] = Array.from(
      document.querySelectorAll("#audioscope-compare-static-toggle"),
    ) as HTMLButtonElement[];

    second.focus();
    await user.keyboard("s");

    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });

  it("jumps focus to the compare pane's motion controls with M", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <button type="button">outside</button>
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const toggle = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;

    (screen.getByRole("button", { name: "outside" }) as HTMLButtonElement).focus();
    await user.keyboard("m");
    expect(document.activeElement).toBe(toggle);
  });

  it("does not steal focus with M while typing in a form field", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <textarea aria-label="memo" />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const toggle = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;

    const input = screen.getByLabelText("note");
    await user.click(input);
    await user.keyboard("mm");
    expect(input).toHaveValue("mm");
    expect(document.activeElement).toBe(input);

    const memo = screen.getByLabelText("memo");
    await user.click(memo);
    await user.keyboard("m");
    expect(memo).toHaveValue("m");
    expect(document.activeElement).toBe(memo);
    expect(document.activeElement).not.toBe(toggle);
  });

  it("advertises M on the SonicSIM panel's reduced-motion notice", () => {
    setReducedMotion(true);
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    expect(screen.getAllByText(/jump to motion controls/i).length).toBeGreaterThan(0);
  });

  it("jumping to motion controls from the SonicSIM panel lands on the only pane on the page", async () => {
    const user = userEvent.setup();
    setReducedMotion(true);
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const compareToggle = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;
    const links = screen.getAllByRole("button", { name: /jump to motion controls/i });

    await user.click(links[0]);
    // The SonicSIM panel no longer has an anchor of its own, so M-driven jumps
    // land on the compare pane's Static toggle instead.
    expect(document.activeElement).toBe(compareToggle);
  });

  it("announces the compare pane state independently of the SonicSIM panel", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const compare = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;
    const compareStatus = document.querySelector("#audioscope-compare-status") as HTMLElement;
    const singleStatus = document.querySelector("#audioscope-status") as HTMLElement;

    compare.focus();
    await user.keyboard("s");
    expect(compareStatus.textContent).toMatch(/Comparison is static/i);
    expect(singleStatus.textContent).not.toMatch(/static/i);
  });

  it("toggles Static and playback with S and K inside the compare pane", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const compare = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;
    compare.focus();

    await user.keyboard("s");
    expect(compare).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("k");
    expect(compare).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^pause\b/i })).toBeInTheDocument();
  });

  it("does not toggle or announce compare state when S and K are typed into form fields", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <textarea aria-label="memo" />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const compare = document.querySelector(
      "#audioscope-compare-static-toggle",
    ) as HTMLButtonElement;
    const status = document.querySelector("#audioscope-compare-status") as HTMLElement;
    const before = status.textContent;

    const input = screen.getByLabelText("note");
    await user.click(input);
    await user.keyboard("sk");
    expect(input).toHaveValue("sk");
    expect(document.activeElement).toBe(input);

    const memo = screen.getByLabelText("memo");
    await user.click(memo);
    await user.keyboard("ks");
    expect(memo).toHaveValue("ks");
    expect(document.activeElement).toBe(memo);

    expect(compare).toHaveAttribute("aria-pressed", "false");
    expect(status.textContent).toBe(before);
  });

  it("documents the shortcuts on screen for the compare panel", () => {
    render(
      <div data-testid="scope">
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const scope = within(screen.getByTestId("scope"));
    expect(scope.getAllByText(/S static/i).length).toBe(1);
    expect(scope.getAllByText(/switch panes/i).length).toBe(1);
  });
});
