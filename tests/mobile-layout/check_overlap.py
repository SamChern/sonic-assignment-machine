"""Responsive overlap check: modals, toasts, docked progress panel vs the sticky bottom nav.

Run with:  python3 tests/mobile-layout/check_overlap.py
Asserts that at common mobile/tablet/desktop viewports no fixed overlay surface
covers the sticky bottom nav, and nothing sits inside the safe-area inset.
"""

import asyncio
import sys
import os
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("SONICSIM_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    ("iphone-se", 375, 667),
    ("iphone-14", 390, 844),
    ("pixel-7", 412, 915),
    ("iphone-14-pro-max", 430, 932),
    ("ipad-mini", 768, 1024),
    ("desktop", 1280, 900),
]

# Inject synthetic overlay surfaces that use the same utility classes the app uses,
# so geometry is verified without driving every feature flow.
PROBE = """
() => {
  const mk = (id, cls, html) => {
    const el = document.createElement('div');
    el.id = id;
    el.className = cls;
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };
  mk('probe-progress', 'docked-above-nav', '<div style="height:64px;background:#0af">progress</div>');
  mk('probe-backdrop', 'overlay-backdrop-above-nav z-overlay fixed inset-0', '');
  mk('probe-sheet', 'sheet-bottom-above-nav z-overlay fixed inset-x-0 bottom-0 overlay-safe-bottom', '<div style="height:120px">sheet</div>');
  mk('probe-banner', 'above-mobile-nav z-banner fixed inset-x-0 flex justify-center px-4', '<div style="height:48px">banner</div>');
}
"""

RECTS = """
() => {
  const out = {};
  const nav = document.querySelector('nav[aria-label="Quick navigation"]');
  const grab = (key, el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[key] = { top: r.top, bottom: r.bottom, height: r.height, z: cs.zIndex, display: cs.display, position: cs.position };
  };
  grab('nav', nav);
  grab('progress', document.getElementById('probe-progress'));
  grab('backdrop', document.getElementById('probe-backdrop'));
  grab('sheet', document.getElementById('probe-sheet'));
  grab('banner', document.getElementById('probe-banner'));
  return out;
}
"""

failures: list[str] = []


def check(name: str, condition: bool, detail: str) -> None:
    if not condition:
        failures.append(f"{name}: {detail}")


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for label, w, h in VIEWPORTS:
            context = await browser.new_context(viewport={"width": w, "height": h})
            page = await context.new_page()
            await page.goto(BASE, wait_until="domcontentloaded")
            await page.wait_for_timeout(800)
            await page.evaluate(PROBE)
            await page.wait_for_timeout(200)
            rects = await page.evaluate(RECTS)
            await page.screenshot(path=str(SCREENSHOTS / f"{label}.png"))

            nav = rects.get("nav")
            mobile = w < 640
            if mobile:
                check(label, nav is not None and nav["height"] > 0, "sticky bottom nav missing on mobile")
            else:
                check(
                    label,
                    nav is None or nav["display"] == "none" or nav["height"] == 0,
                    "bottom nav should be hidden from sm up",
                )

            if not nav or nav["height"] == 0 or nav["display"] == "none":
                # Desktop: docked panel must be inline, not fixed.
                prog = rects.get("progress")
                check(label, prog is not None and prog["position"] == "static", "progress panel should be inline on desktop")
                await context.close()
                continue

            nav_top = nav["top"]
            nav_z = int(nav["z"]) if nav["z"].isdigit() else 0

            for key in ("progress", "sheet", "banner"):
                r = rects.get(key)
                if not r:
                    failures.append(f"{label}: probe {key} not found")
                    continue
                check(label, r["bottom"] <= nav_top + 1, f"{key} overlaps the nav (bottom={r['bottom']:.1f} nav_top={nav_top:.1f})")
                z = int(r["z"]) if r["z"].isdigit() else 0
                check(label, z < nav_z, f"{key} z-index {z} must be below nav z-index {nav_z}")

            backdrop = rects["backdrop"]
            check(label, backdrop["bottom"] <= nav_top + 1, f"dialog backdrop covers the nav (bottom={backdrop['bottom']:.1f})")

            await context.close()
        await browser.close()

    if failures:
        print("FAIL")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print(f"PASS — no overlap across {len(VIEWPORTS)} viewports")


asyncio.run(main())
