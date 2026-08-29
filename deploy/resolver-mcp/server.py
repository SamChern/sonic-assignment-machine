# server.py — Step 13, The Resolver's tool belt as an MCP server.
#
# Same pattern as deploy/librosa-mcp: a FastMCP stdio server fronted by
# mcp-proxy (loopback SSE) and nginx (TLS + Bearer). Exposing the belt over MCP
# is the five-year bet: any future model — Claude, GPT, or whatever ships next —
# drives these same four tools with no rework, and the edge function keeps its
# own in-process copies as the fallback path.
#
# Tools:
#   lookup_taxonomy(query, limit)      -> nearest existing taxonomy nodes
#   propose_crosswalk(code, anchors)   -> stage crosswalk anchors on a node
#   embed_text(text)                   -> 1536-d vector via the semantic service
#   search_web(query, hint)            -> open-web METADATA only (allow-listed)
#
# Never fetches, decodes, or streams audio: meaning about sound is freely
# referenceable, recordings are not.

from __future__ import annotations

import json
import os
from typing import Any, Optional
from urllib.parse import quote, urlparse

import requests
from fastmcp import FastMCP

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SEMANTIC_URL = os.environ.get("SEMANTIC_SVC_URL", "http://127.0.0.1:8080").rstrip("/")
SEMANTIC_TOKEN = os.environ.get("SEMANTIC_SVC_TOKEN", "")

ALLOWED_WEB_HOSTS = {"en.wikipedia.org", "api.duckduckgo.com"}

mcp = FastMCP(
    "SonicSIM Resolver tool belt",
    description=(
        "Taxonomy lookup, crosswalk proposals, text embedding and open-web "
        "metadata search for resolving unknown audience signals into "
        "sonic-semantic meaning."
    ),
)


def _rest(path: str, method: str = "GET", **kwargs: Any) -> Any:
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    res = requests.request(
        method, f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, timeout=30, **kwargs
    )
    res.raise_for_status()
    return res.json() if res.text else None


@mcp.tool()
def lookup_taxonomy(query: str, limit: int = 10) -> list[dict]:
    """Existing taxonomy nodes whose code or label matches `query`."""
    like = quote(f"*{query}*")
    rows = _rest(
        f"taxonomy_nodes?or=(code.ilike.{like},label.ilike.{like})"
        f"&select=code,label,reviewed,source&limit={max(1, min(limit, 50))}"
    )
    return rows or []


@mcp.tool()
def propose_crosswalk(code: str, anchors: list[dict]) -> dict:
    """Stage crosswalk anchors ({code,label,confidence}) on a taxonomy node.

    Written unapproved: an admin promotes them in the review UI.
    """
    matches = [
        {
            "code": str(a.get("code")),
            "label": str(a.get("label", a.get("code"))),
            "similarity": float(a.get("confidence", 0.4)),
            "via": "agent",
            "approved": False,
        }
        for a in anchors
        if a.get("code")
    ][:3]
    _rest(
        f"taxonomy_nodes?code=eq.{quote(code)}",
        method="PATCH",
        data=json.dumps({"crosswalk": {"matches": matches}, "reviewed": False, "source": "agent"}),
    )
    return {"code": code, "staged": len(matches)}


@mcp.tool()
def embed_text(text: str) -> list[float]:
    """1536-d semantic vector for `text` from the local semantic service."""
    headers = {"Content-Type": "application/json"}
    if SEMANTIC_TOKEN:
        headers["Authorization"] = f"Bearer {SEMANTIC_TOKEN}"
    res = requests.post(
        f"{SEMANTIC_URL}/embed_text", headers=headers, json={"texts": [text]}, timeout=120
    )
    res.raise_for_status()
    payload = res.json()
    vectors = payload.get("vectors") or payload.get("embeddings") or []
    return vectors[0] if vectors else []


def _get_json(url: str) -> Optional[dict]:
    if urlparse(url).hostname not in ALLOWED_WEB_HOSTS:
        return None
    try:
        res = requests.get(
            url,
            headers={"Accept": "application/json", "User-Agent": "SonicSIM-Resolver/1.0"},
            timeout=20,
        )
        if not res.ok:
            return None
        return res.json()
    except Exception:
        return None


@mcp.tool()
def search_web(query: str, hint: str = "") -> list[dict]:
    """Open-web METADATA about a symbol (never audio): summaries and abstracts."""
    q = f"{query} {hint}".strip()
    out: list[dict] = []

    search = _get_json(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=2"
        f"&format=json&srsearch={quote(q)}"
    ) or {}
    for hit in (search.get("query", {}).get("search") or [])[:2]:
        summary = _get_json(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(hit['title'])}"
        ) or {}
        text = summary.get("extract") or ""
        if text:
            out.append({"source": "wikipedia", "title": hit["title"], "text": text[:1200]})

    ia = _get_json(
        f"https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&q={quote(q)}"
    ) or {}
    if ia.get("AbstractText"):
        out.append(
            {
                "source": "duckduckgo",
                "title": ia.get("Heading") or q,
                "text": ia["AbstractText"][:1200],
                "url": ia.get("AbstractURL"),
            }
        )
    return out[:5]


if __name__ == "__main__":
    mcp.run()
