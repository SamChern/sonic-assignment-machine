"""Playwright smoke test: Admin "APIs & MCPs" tab flows + EC2 status actions.

All backend traffic is mocked at the network layer (Supabase edge functions and
the `user_roles` lookup that grants admin), so the test never touches real
credentials or the EC2 analysis API.

Run:  python3 tests/e2e/admin_apis_ec2_smoke.py
"""

import asyncio
import json
import os
import pathlib

from playwright.async_api import async_playwright

BASE = os.environ.get("SMOKE_BASE_URL", "http://localhost:8080")
OUT = pathlib.Path(__file__).parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

STATUS_PAYLOAD = {
    "status": {
        "apple_music": {
            "fields": ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"],
            "updated_at": "2026-08-01T00:00:00.000Z",
        }
    },
    "lastTest": {
        "apple_music": {
            "integration_id": "apple_music",
            "success": True,
            "latency_ms": 140,
            "error_message": None,
            "tested_at": "2026-08-02T00:00:00.000Z",
        }
    },
}

FUNCTION_RESPONSES = {
    "admin-get-credential-status": STATUS_PAYLOAD,
    "admin-set-credentials": {"success": True},
    "apple-music-test": {"success": True, "latency_ms": 91},
    "apple-music-search": {"success": True, "results": [{"name": "Discovery"}]},
    "mcp-call": {"success": True, "tools": [{"name": "get_activations"}]},
    "mcp-test": {"success": True, "latency_ms": 55},
    "librosa-rest-test": {"success": True, "latency_ms": 61},
    "spotify-audio-features-test": {"success": True, "latency_ms": 70},
    "aws-proxy": {
        "status": "healthy",
        "region": "us-east-1",
        "instance_id": "i-0smoke123",
        "hostname": "librosa-smoke",
        "instance_type": "t3.large",
        "version": "1.4.2",
        "uptime": "2d 1h",
    },
}

calls: list[str] = []
failures: list[str] = []


def check(label: str, condition: bool) -> None:
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures.append(label)


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        # --- mock every edge function call -------------------------------------
        async def functions_route(route):
            name = route.request.url.split("/functions/v1/")[1].split("?")[0]
            calls.append(name)
            body = FUNCTION_RESPONSES.get(name, {"success": True})
            await route.fulfill(
                status=200,
                content_type="application/json",
                headers={"access-control-allow-origin": "*"},
                body=json.dumps(body),
            )

        await context.route("**/functions/v1/**", functions_route)

        # --- grant the signed-in session the admin role ------------------------
        async def roles_route(route):
            await route.fulfill(
                status=200,
                content_type="application/json",
                headers={"access-control-allow-origin": "*"},
                body=json.dumps([{"role": "admin"}]),
            )

        await context.route("**/rest/v1/user_roles*", roles_route)

        page = await context.new_page()

        # restore the injected Supabase session (cookies + localStorage)
        cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
        if cookies_json:
            await context.add_cookies(
                [{**c, "url": BASE} for c in json.loads(cookies_json)]
            )
        await page.goto(BASE, wait_until="domcontentloaded")
        key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        if key and session:
            await page.evaluate(
                "([k, v]) => localStorage.setItem(k, v)", [key, session]
            )

        await page.goto(f"{BASE}/admin", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        check("admin dashboard reachable", "/admin" in page.url)
        if "/admin" not in page.url:
            await page.screenshot(path=str(OUT / "smoke_admin_denied.png"))
            await browser.close()
            return 1

        # --- APIs & MCPs tab ---------------------------------------------------
        apis_tab = page.get_by_role("tab", name="APIs & MCPs")
        await apis_tab.first.click()
        await page.wait_for_timeout(1500)
        check("credential status loaded", "admin-get-credential-status" in calls)
        check(
            "connected count rendered",
            await page.get_by_text("Connected (").first.is_visible(),
        )

        # REST view: connection test + sample request
        await page.get_by_role("tab", name="REST (").first.click()
        await page.wait_for_timeout(800)
        await page.get_by_role("button", name="Test connection").first.click()
        await page.wait_for_timeout(1200)
        check("connection test invoked", "apple-music-test" in calls)

        await page.get_by_role("button", name="Search Apple Music").first.click()
        await page.wait_for_timeout(1200)
        check("sample request invoked", "apple-music-search" in calls)
        await page.screenshot(path=str(OUT / "smoke_apis_rest.png"))

        # MCP view: list tools
        await page.get_by_role("tab", name="MCP (").first.click()
        await page.wait_for_timeout(800)
        await page.get_by_role("button", name="List MCP tools").first.click()
        await page.wait_for_timeout(1200)
        check("mcp list-tools invoked", "mcp-call" in calls)
        await page.screenshot(path=str(OUT / "smoke_apis_mcp.png"))

        # --- EC2 status tab ----------------------------------------------------
        await page.get_by_role("tab", name="EC2 status").first.click()
        await page.wait_for_timeout(1500)
        check("ec2 health probed", "aws-proxy" in calls)
        check(
            "ec2 instance details rendered",
            await page.get_by_text("i-0smoke123").first.is_visible(),
        )

        before = calls.count("aws-proxy")
        await page.get_by_role("button", name="Refresh").last.click()
        await page.wait_for_timeout(1500)
        check("refresh re-probes health", calls.count("aws-proxy") > before)

        before = calls.count("aws-proxy")
        await page.get_by_role("button", name="Reconnect").first.click()
        await page.wait_for_timeout(2500)
        check("reconnect probes twice", calls.count("aws-proxy") >= before + 2)
        await page.screenshot(path=str(OUT / "smoke_ec2_status.png"))

        await browser.close()

    print(f"\n{len(failures)} failing check(s)" if failures else "\nAll smoke checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
