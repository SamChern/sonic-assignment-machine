## Deploy the Librosa MCP bridge on EC2

Everything you need is already committed under **`deploy/librosa-mcp/`** (`server_extended.py`, `librosa-mcp.service`, `nginx-librosa-mcp.conf`, `README.md`). This plan is the operator runbook — no app code changes are required. After it's done, you'll paste a URL + token into the existing `/admin/integrations` MCP Servers tab.

> ⚠️ All commands run **on the EC2 instance**, not in Lovable. Lovable's read-only/default modes can't SSH for you. I'll prep a small helper if useful (see step 7).

---

### Prerequisites
- Ubuntu 22.04+ EC2 instance you can SSH into (the same box that already runs your Express analyze server is fine — different port).
- A DNS hostname pointing at the instance (e.g. `mcp.audio.yourdomain.com`). Needed for TLS via Let's Encrypt.
- EC2 Security Group allows inbound **TCP 443** (and 80 for the cert challenge). Do **not** open 8765.

---

### Step 1 — Copy the kit to the box
From your laptop, in the project root:
```bash
scp -r deploy/librosa-mcp ubuntu@<EC2_HOST>:~/
```

### Step 2 — Install system + Python deps (on EC2)
```bash
ssh ubuntu@<EC2_HOST>
sudo apt-get update
sudo apt-get install -y libsndfile1 ffmpeg python3-pip nginx certbot python3-certbot-nginx
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
uv tool install mcp-music-analysis   # upstream (kept for parity)
uv tool install mcp-proxy            # stdio→SSE bridge
```

### Step 3 — Install the extended server
```bash
sudo mkdir -p /opt/librosa-mcp
sudo cp ~/librosa-mcp/server_extended.py /opt/librosa-mcp/
sudo chown -R ubuntu:ubuntu /opt/librosa-mcp
uv venv /opt/librosa-mcp/.venv
/opt/librosa-mcp/.venv/bin/pip install \
  "fastmcp==0.4.1" "librosa>=0.10" "numpy>=1.21" "scipy>=1.10" \
  "scikit-learn>=1.0" "soundfile==0.13.1" "matplotlib>=3.5" \
  "requests" "pytubefix==8.12.2"
```

### Step 4 — Generate the Bearer token
```bash
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN" | sudo tee /etc/librosa-mcp.token > /dev/null
sudo chmod 600 /etc/librosa-mcp.token
echo "SAVE THIS — paste into Lovable admin: $TOKEN"
```

### Step 5 — Install + start systemd unit
```bash
sudo cp ~/librosa-mcp/librosa-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now librosa-mcp
sudo systemctl status librosa-mcp     # expect: active (running)
journalctl -u librosa-mcp -n 50 --no-pager   # expect: Uvicorn running on http://127.0.0.1:8765
```

### Step 6 — Install nginx site + TLS
```bash
sudo cp ~/librosa-mcp/nginx-librosa-mcp.conf /etc/nginx/sites-available/librosa-mcp
sudo ln -sf /etc/nginx/sites-available/librosa-mcp /etc/nginx/sites-enabled/librosa-mcp

# Edit two placeholders: YOUR_HOST (3 places) and TOKEN_GOES_HERE (1 place)
sudo sed -i "s/YOUR_HOST/mcp.audio.yourdomain.com/g" /etc/nginx/sites-available/librosa-mcp
sudo sed -i "s/TOKEN_GOES_HERE/$(sudo cat /etc/librosa-mcp.token)/" /etc/nginx/sites-available/librosa-mcp

sudo nginx -t
sudo certbot --nginx -d mcp.audio.yourdomain.com    # provisions cert + reloads
```

### Step 7 — Smoke-test from your laptop
```bash
TOKEN=<paste-from-step-4>
curl -i https://mcp.audio.yourdomain.com/healthz
# → 200 ok

curl -N -H "Authorization: Bearer $TOKEN" \
     -H "Accept: text/event-stream" \
     https://mcp.audio.yourdomain.com/librosa/sse
# → should hold open and stream "event: endpoint" within ~1s
```

If `healthz` is 200 but `/librosa/sse` returns 401 → token mismatch (re-do step 6 sed).
If 404 → missing trailing slash on `location /librosa/`.
If 502 → systemd service isn't up; recheck step 5 logs.

### Step 8 — Wire into Lovable
1. Navigate to `/admin/integrations` → **MCP Servers** tab → **Librosa Music Analysis MCP**.
2. Fill:
   - **MCP Server URL**: `https://mcp.audio.yourdomain.com/librosa/sse`
   - **Auth Scheme**: `Bearer`
   - **Auth Token**: the token from step 4
   - **Extra Headers**: leave blank
3. **Save** → **Test connection** → expect `Connection OK (NN ms)`.

The placeholder validator I added last turn will block the save if you accidentally leave `your-ec2-host` in the URL.

---

### What I'll do once you approve
This is operational work I can't run for you, but on approval I'll switch to default mode and:
1. **Add a one-shot install script** `deploy/librosa-mcp/install.sh` that runs steps 2–6 idempotently (you scp + run; one command instead of ten).
2. **Add `deploy/librosa-mcp/smoke-test.sh`** that runs step 7 against an arbitrary host+token.
3. **Tighten** the nginx config with a generic `/healthz` upstream check and rate-limit the `/librosa/` location (10 req/s burst 20) so a stray client can't pin the box.
4. *(Optional, ask first)* Wire `analyze-audio` to actually call the new MCP via the existing `mcp-call` edge function and enrich each source with real `tempo` + segment count.

### Files this plan would touch (default mode)
- **Create** `deploy/librosa-mcp/install.sh`
- **Create** `deploy/librosa-mcp/smoke-test.sh`
- **Edit**  `deploy/librosa-mcp/nginx-librosa-mcp.conf` (add rate limit + upstream healthcheck stanza)
- *No frontend or edge function changes.* Item 4 above is a separate follow-up.

### Open questions
1. What's the hostname you'll point at the box (so I can pre-fill it in `install.sh`)?
2. Want item 4 (`analyze-audio` actually calling the MCP) bundled in, or keep this PR purely about the bridge?