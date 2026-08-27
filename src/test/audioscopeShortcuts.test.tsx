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

    await user.keyboard("[[");
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


  it("jumps focus to motion controls with M from inside the single pane", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const toggle = document.querySelector("#audioscope-static-toggle") as HTMLButtonElement;
    const legend = screen.getByRole("button", { name: /how to read this/i }) as HTMLButtonElement;

    legend.focus();
    expect(document.activeElement).toBe(legend);

    await user.keyboard("m");
    expect(document.activeElement).toBe(toggle);
  });

  it("jumps focus to the motion controls of the pane the user is in (compare)", async () => {
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

    // Focus a non-anchor control inside the compare pane, then press M.
    const compareChip = compare.parentElement?.querySelector(
      "button:not(#audioscope-compare-static-toggle)",
    ) as HTMLButtonElement | null;
    (compareChip ?? compare).focus();

    await user.keyboard("m");
    expect(document.activeElement).toBe(compare);
    expect(document.activeElement).not.toBe(single);
  });

  it("falls back to the first pane when M is pressed outside every pane", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <button type="button">outside</button>
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const single = document.querySelector("#audioscope-static-toggle") as HTMLButtonElement;

    (screen.getByRole("button", { name: "outside" }) as HTMLButtonElement).focus();
    await user.keyboard("m");
    expect(document.activeElement).toBe(single);
  });

  it("does not steal focus with M while typing in a form field", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <textarea aria-label="memo" />
        <SonicSimPanel subjects={subjects} />
        <AudioscopeCompare entities={compareEntities} similarity={72} />
      </div>,
    );
    const single = document.querySelector("#audioscope-static-toggle") as HTMLButtonElement;
    const compare = document.querySelector(
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
    expect(document.activeElement).not.toBe(single);
    expect(document.activeElement).not.toBe(compare);
  });

  it("advertises M on the motion-controls link and shortcut hint", () => {
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    expect(screen.getAllByText(/jump to motion controls/i).length).toBeGreaterThan(0);
  });


  it("announces the new state in the live region when S and K are pressed", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const toggle = staticBtn() as HTMLButtonElement;
    const status = document.querySelector("#audioscope-status") as HTMLElement;
    expect(status).toHaveAttribute("aria-live", "polite");

    toggle.focus();
    await user.keyboard("s");
    expect(status.textContent).toMatch(/static — one frame at 1\.25 seconds/i);

    await user.keyboard("k");
    expect(status.textContent).toMatch(/animating at 0\.25x speed/i);

    await user.keyboard("k");
    expect(status.textContent).toMatch(/paused/i);
  });

  it("announces the compare pane state independently", async () => {
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

  it("does not toggle or announce when S and K are typed into form fields", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scope">
        <input aria-label="note" />
        <textarea aria-label="memo" />
        <SonicSimPanel subjects={subjects} />
      </div>,
    );
    const toggle = staticBtn() as HTMLButtonElement;
    const status = document.querySelector("#audioscope-status") as HTMLElement;
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

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(status.textContent).toBe(before);
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
