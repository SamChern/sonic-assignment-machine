# Resolver MCP tool belt (Step 13)

The Resolver's four tools — `lookup_taxonomy`, `propose_crosswalk`, `embed_text`,
`search_web` — exposed over MCP so any future model can drive them unchanged.
Optional: the `signal-resolver` edge function carries in-process equivalents and
runs fine without this box. Install it when you want the belt reachable by
external MCP clients.

## Install (EC2, ~2 minutes)

```bash
sudo mkdir -p /opt/resolver-mcp && sudo chown ubuntu:ubuntu /opt/resolver-mcp
cd /opt/resolver-mcp
python3 -m venv .venv && .venv/bin/pip install -q fastmcp requests
curl -fsSL "$FUNCTIONS_URL/ingest-worker-bootstrap?file=resolver-mcp" -o server.py \
  || cp ~/sonicsim/deploy/resolver-mcp/server.py .   # or scp it up

sudo tee /etc/resolver-mcp.env >/dev/null <<'ENV'
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service key>
SEMANTIC_SVC_URL=http://127.0.0.1:8080
SEMANTIC_SVC_TOKEN=<semantic svc token>
ENV
sudo chmod 600 /etc/resolver-mcp.env

sudo cp resolver-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now resolver-mcp
systemctl status resolver-mcp --no-pager
```

`mcp-proxy` serves SSE on `127.0.0.1:8766`; front it with nginx exactly like
`nginx-librosa-mcp.conf` (TLS + `Authorization: Bearer`) if you expose it.

## Boundaries

- Metadata only. `search_web` is host allow-listed (Wikipedia, DuckDuckGo
  instant answers) and never fetches audio bytes or stream URLs.
- `propose_crosswalk` always writes anchors unapproved — promotion happens in
  the admin review UI, never from the agent.
