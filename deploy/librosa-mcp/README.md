# Librosa MCP + REST — EC2 deployment kit

Two sibling services on the same EC2 box, both backed by `server_extended.py`:

| Service | Port | Use it for |
|---|---|---|
| **librosa-mcp** (MCP over SSE) | 8765 | Full MCP capability — agents that speak the protocol can list tools, sample, etc. |
| **librosa-rest** (plain HTTPS) | 8766 | Quick `POST /analyze` calls from edge functions / web clients while MCP is being stabilized. Simpler, fewer moving parts. |

Both share `/opt/librosa-mcp/.venv` and the same extended librosa pipeline. Install MCP first (`./install.sh`), then add REST on top (`./install-rest.sh`).

A drop-in deployment for the [`hugohow/mcp-music-analysis`](https://github.com/hugohow/mcp-music-analysis) MCP server **plus our fork** (`server_extended.py`) that adds the 4 capability buckets the upstream is missing:

| Bucket | New tools |
|---|---|
| **Sequential modeling** | `dtw`, `viterbi`, `viterbi_discriminative` |
| **Utilities — array** | `frame`, `pad_center`, `normalize`, `stack_memory` |
| **Utilities — matching** | `match_events`, `match_intervals` |
| **Utilities — misc** | `samples_to_time`, `time_to_samples`, `frames_to_time`, `time_to_frames` |
| **Laplacian segmentation** | `recurrence_matrix`, `laplacian_segmentation` (full Brian McFee pipeline) |

Plus everything from upstream (`load`, `tempo`, `mfcc`, `chroma_cqt`, `beat_track`, `get_duration`, `download_from_url`, `download_from_youtube`).

---

## Quick install (recommended)

From your laptop, in the project root:

```bash
scp -r deploy/librosa-mcp ubuntu@<EC2_HOST>:~/
ssh ubuntu@<EC2_HOST>
cd ~/librosa-mcp
sudo HOSTNAME=mcp.audio.example.com EMAIL=you@example.com ./install.sh
```

The script installs system + Python deps, drops in the extended server, generates a Bearer token, installs the systemd unit, and configures nginx with TLS via Let's Encrypt. On success it prints the **MCP Server URL** and **Auth Token** to paste into Lovable's `/admin/integrations` → MCP Servers tab.

Verify from anywhere:

```bash
./smoke-test.sh https://mcp.audio.example.com <token-from-installer>
```

If you'd rather run each step yourself, the manual instructions are below.

---

## 1. One-time install on the EC2 box (manual)

SSH in (Ubuntu 22.04+ assumed). Replace `ubuntu` with your username if different.

```bash
# System deps for librosa (libsndfile, ffmpeg)
sudo apt-get update
sudo apt-get install -y libsndfile1 ffmpeg python3-pip nginx

# uv (fast Python package manager) — installs to ~/.local/bin
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# Install the upstream package and the stdio→SSE bridge
uv tool install mcp-music-analysis
uv tool install mcp-proxy

# --- Drop in our extended server (with the 4 new buckets) ---
sudo mkdir -p /opt/librosa-mcp
sudo cp server_extended.py /opt/librosa-mcp/
sudo chown -R ubuntu:ubuntu /opt/librosa-mcp

# Create a venv that has librosa + fastmcp for the extended server
uv venv /opt/librosa-mcp/.venv
/opt/librosa-mcp/.venv/bin/pip install \
  "fastmcp==0.4.1" "librosa>=0.10" "numpy>=1.21" "scipy>=1.10" \
  "scikit-learn>=1.0" "soundfile==0.13.1" "matplotlib>=3.5" \
  "requests" "pytubefix==8.12.2"
```

## 2. Generate a Bearer token and install it

```bash
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN" | sudo tee /etc/librosa-mcp.token > /dev/null
sudo chmod 600 /etc/librosa-mcp.token
echo "Save this — you'll paste it into the Lovable admin UI:"
echo "$TOKEN"
```

## 3. Install the systemd unit and start it

```bash
sudo cp librosa-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now librosa-mcp
sudo systemctl status librosa-mcp        # should be active (running)
journalctl -u librosa-mcp -n 50          # confirm "Uvicorn running on ..."
```

The service binds to `127.0.0.1:8765` (SSE not exposed publicly — nginx fronts it).

## 4. Install the nginx site

```bash
sudo cp nginx-librosa-mcp.conf /etc/nginx/sites-available/librosa-mcp
sudo ln -sf /etc/nginx/sites-available/librosa-mcp /etc/nginx/sites-enabled/librosa-mcp

# Edit the file: replace YOUR_HOST and the inline-checked TOKEN_GOES_HERE
sudo $EDITOR /etc/nginx/sites-available/librosa-mcp

sudo nginx -t && sudo systemctl reload nginx
```

If you don't have TLS yet, run `sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-host.example.com`.

## 5. Open the port in EC2

In the EC2 console → Security Groups → inbound rules: allow **TCP 443** from `0.0.0.0/0` (or restrict to Supabase egress IPs if you want to be strict). Do **not** open 8765 — the service should only be reachable via nginx.

## 6. Plug into Lovable

1. Go to `/admin/integrations` → **MCP Servers** tab → **Librosa Music Analysis MCP**
2. **MCP Server URL**: `https://your-host.example.com/librosa/sse`
3. **Auth Scheme**: `Bearer`
4. **Auth Token**: the token you generated in step 2
5. Save → Test connection. You should see "Connection OK (NN ms)".

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Test failed: HTTP 401` | nginx Bearer check rejected your token. Re-paste in admin UI. |
| `Test failed: HTTP 406` | The `mcp-test` edge function already sends the required `Accept: application/json, text/event-stream` — if you see this, check nginx isn't stripping headers. |
| `Test failed: Fetch failed: ...` | DNS / firewall. Curl the URL from another box. |
| Tool calls fail with "no such file" | Each `tempo`/`mfcc`/etc. call needs a `path_audio_time_series_y` from a previous `load` call — `/tmp/*_y.csv`. Make sure all calls in one analysis hit the same instance (don't horizontally scale without shared `/tmp`). |
| Want to update | `uv tool upgrade mcp-music-analysis && sudo systemctl restart librosa-mcp` |
