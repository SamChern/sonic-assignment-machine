import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");

const css = read("src/index.css");
const nav = read("src/components/MobileBottomNav.tsx");
const banner = read("src/components/PwaUpdateBanner.tsx");
const dialog = read("src/components/ui/dialog.tsx");
const sheet = read("src/components/ui/sheet.tsx");
const toast = read("src/components/ui/toast.tsx");
const uploadPanel = read("src/components/UploadProgressPanel.tsx");
const app = read("src/App.tsx");

/** Parse a numeric custom property from the :root block. */
const zToken = (name: string) => {
  const match = css.match(new RegExp(`--${name}:\\s*(\\d+)`));
  expect(match, `missing --${name} token`).toBeTruthy();
  return Number(match![1]);
};

describe("mobile safe-area tokens", () => {
  it("defines a single source of truth for the safe-area insets and nav height", () => {
    expect(css).toContain("--safe-bottom: env(safe-area-inset-bottom, 0px)");
    expect(css).toContain("--safe-top: env(safe-area-inset-top, 0px)");
    expect(css).toContain("--mobile-nav-h:");
    expect(css).toContain(
      "--above-mobile-nav-offset: calc(var(--mobile-nav-h) + var(--safe-bottom) + 0.75rem)",
    );
  });

  it("never hardcodes env(safe-area-inset-*) outside the token definitions", () => {
    const usages = css.match(/env\(safe-area-inset-[a-z]+/g) ?? [];
    // Only the two :root token declarations may reference env() directly.
    expect(usages).toHaveLength(2);

    for (const [name, source] of Object.entries({ nav, banner, dialog, sheet, toast, uploadPanel, app })) {
      expect(source, `${name} should use the CSS tokens, not raw env()`).not.toContain(
        "safe-area-inset",
      );
    }
  });

  it("reserves page padding for the nav plus the home indicator", () => {
    expect(css).toContain("padding-bottom: calc(var(--mobile-nav-h) + var(--safe-bottom))");
    expect(app).toContain("pb-mobile-nav");
  });
});

describe("z-index stacking scale", () => {
  it("keeps the sticky bottom nav above dialogs, sheets and the banner", () => {
    const docked = zToken("z-docked");
    const overlay = zToken("z-overlay");
    const bannerZ = zToken("z-banner");
    const navZ = zToken("z-nav");
    const toastZ = zToken("z-toast");

    expect(docked).toBeLessThan(overlay);
    expect(overlay).toBeLessThan(bannerZ);
    expect(bannerZ).toBeLessThan(navZ);
    expect(navZ).toBeLessThan(toastZ);
  });

  it("wires every overlay surface to the scale instead of ad-hoc z values", () => {
    expect(nav).toContain("z-nav");
    expect(banner).toContain("z-banner");
    expect(dialog).toContain("z-overlay");
    expect(sheet).toContain("z-overlay");
    expect(uploadPanel).toContain("docked-above-nav");
    expect(css).toContain("[data-sonner-toaster]");
    expect(css).toContain("z-index: var(--z-toast) !important");
  });
});

describe("overlay geometry on mobile", () => {
  it("stops dialog/sheet backdrops and bottom sheets above the nav", () => {
    expect(css).toContain(".overlay-backdrop-above-nav");
    expect(css).toContain(".sheet-bottom-above-nav");
    expect(css).toContain("bottom: calc(var(--mobile-nav-h) + var(--safe-bottom))");
    expect(dialog).toContain("overlay-backdrop-above-nav");
    expect(sheet).toContain("sheet-bottom-above-nav");
  });

  it("docks the upload progress panel above the nav on mobile and inline on desktop", () => {
    const block = css.slice(css.indexOf(".docked-above-nav"));
    expect(block).toContain("bottom: var(--above-mobile-nav-offset)");
    expect(block).toContain("z-index: var(--z-docked)");
    expect(block).toContain("position: static");
  });

  it("lifts bottom-anchored toasts and the banner above the nav", () => {
    expect(css).toContain('[data-sonner-toaster][data-y-position="bottom"]');
    expect(css).toContain("bottom: var(--above-mobile-nav-offset) !important");
    expect(banner).toContain("above-mobile-nav");
  });
});
