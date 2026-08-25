"""E2E: admin dashboard -> Intuizi Console link, plus a rendered-text audit that
"Integration Status" never appears anywhere in the flow.

Run: python3 tests/e2e/admin_console_link.py
Requires an injected Lovable preview session (admin user).
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

FORBIDDEN = "integration status"


async def audit(page, label: str, failures: list[str]) -> None:
    text = (await page.inner_text("body")).lower()
    if FORBIDDEN in text:
        failures.append(f'"Integration Status" rendered on {label} ({page.url})')


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
        if cookies_json:
            cookies = json.loads(cookies_json)
            for c in cookies:
                c["url"] = BASE
            await context.add_cookies(cookies)

        await page.goto(BASE, wait_until="domcontentloaded")
        key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        if key and session:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(session)})"
            )

        await page.goto(f"{BASE}/admin", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(SHOTS / "1_admin_dashboard.png"))
        await audit(page, "admin dashboard", failures)

        link = page.get_by_role("button", name="Intuizi Console").first
        if await link.count() == 0:
            link = page.get_by_text("Intuizi Console").first
        if await link.count() == 0:
            failures.append("no Intuizi Console link on the admin dashboard")
        else:
            await link.click()
            await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SHOTS / "2_intuizi_console.png"))
            if "/admin/pipeline" not in page.url:
                failures.append(f"console link did not navigate: {page.url}")
            heading = await page.inner_text("body")
            if "Intuizi Console" not in heading:
                failures.append("Intuizi Console heading missing on target page")
            await audit(page, "intuizi console page", failures)

        await page.goto(f"{BASE}/admin/semantic", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(SHOTS / "3_data_stream_analysis.png"))
        await audit(page, "data stream analysis page", failures)

        await browser.close()

    if failures:
        print("FAIL")
        for f in failures:
            print(" -", f)
        return 1
    print("PASS: console link works and no legacy label rendered")
    return 0


sys.exit(asyncio.run(main()))
