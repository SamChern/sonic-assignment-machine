"""Visual regression guard for the enterprise /workspace page.

Run with:  python3 tests/mobile-layout/check_workspace_overflow.py

Fails when, at any common viewport and on any workspace tab:
  * the document scrolls horizontally (overflowing cards / action rows),
  * any element renders past the viewport edge (clipped badges),
  * a tab trigger is clipped or its label is ellipsised,
  * content is hidden behind the sticky mobile bottom nav.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("SONICSIM_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path(__file__).parent / "screenshots" / "workspace"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# Step 12 regrouped the workspace nav into four groups, each with its own
# sub-tab row. Expected trigger count per deep link = 4 group triggers + the
# sub-tabs of the group that owns the linked tab.
GROUP_SIZES = {
    "data": 2,
    "discover": 2,
    "analyses": 3,
    "sonicsim": 3,
    "categories": 3,
    "users": 2,
    "outcomes": 2,
    "tags": 1,
}
TABS = list(GROUP_SIZES)
VIEWPORTS = [("mobile", 390, 844), ("tablet", 820, 1100), ("desktop", 1440, 1000)]


PROBE = """
() => {
  const win = window.innerWidth;
  const clipped = [];
  document.querySelectorAll('main *, body > div *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > win + 1 || r.left < -1)) {
      clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 80) });
    }
  });

  const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => ({
    label: (el.textContent || '').trim(),
    truncated: el.scrollWidth > el.clientWidth + 1,
    right: Math.round(el.getBoundingClientRect().right),
  }));

  const nav = document.querySelector('nav[aria-label="Quick navigation"]');
  const navTop = nav && nav.getBoundingClientRect().height > 0
    ? nav.getBoundingClientRect().top
    : null;

  return {
    docScroll: document.documentElement.scrollWidth,
    win,
    clipped: clipped.slice(0, 10),
    tabs,
    navTop,
    bodyBottom: document.body.getBoundingClientRect().bottom,
    bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
    pagePaddingBottom: getComputedStyle(document.querySelector('.pb-mobile-nav') || document.body).paddingBottom,
  };
}
"""

failures: list[str] = []


def check(name: str, condition: bool, detail: str) -> None:
    if not condition:
        failures.append(f"{name}: {detail}")


async def main() -> None:
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if not (storage_key and session_json):
        print("SKIP — no signed-in session available in this environment")
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for label, w, h in VIEWPORTS:
            context = await browser.new_context(viewport={"width": w, "height": h})
            page = await context.new_page()
            await page.goto(BASE, wait_until="domcontentloaded")
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
            )

            for tab in TABS:
                await page.goto(f"{BASE}/workspace?tab={tab}", wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)
                r = await page.evaluate(PROBE)
                await page.screenshot(path=str(SCREENSHOTS / f"{label}_{tab}.png"))
                name = f"{label}/{tab}"

                check(
                    name,
                    r["docScroll"] <= r["win"] + 1,
                    f"horizontal overflow (scrollWidth={r['docScroll']} > {r['win']})",
                )
                check(name, not r["clipped"], f"elements past the viewport edge: {r['clipped']}")

                expected = 4 + GROUP_SIZES[tab]
                check(name, len(r["tabs"]) == expected, f"expected {expected} tab triggers, got {len(r['tabs'])}")

                for t in r["tabs"]:
                    check(name, not t["truncated"], f"tab label truncated: {t['label']!r}")
                    check(
                        name,
                        t["right"] <= r["win"] + 1,
                        f"tab {t['label']!r} extends past the viewport (right={t['right']})",
                    )

                if r["navTop"] is not None:
                    check(
                        name,
                        r["pagePaddingBottom"] not in ("0px", ""),
                        "page must reserve bottom padding for the sticky mobile nav",
                    )

            await context.close()
        await browser.close()

    if failures:
        print("FAIL")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print(f"PASS — /workspace clean across {len(VIEWPORTS)} viewports x {len(TABS)} tabs")


asyncio.run(main())
