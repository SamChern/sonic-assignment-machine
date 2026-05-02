## Goal

Push the updated `deploy/librosa-mcp/server_extended.py` (the `download_from_url` fix that accepts signed URLs with `?token=...` query strings) to your EC2 box, restart the systemd service, and verify it picked up the change.

The Python file lives on EC2 at `/opt/librosa-mcp/server_extended.py`. The systemd unit `librosa-mcp.service` runs `mcp-proxy` which spawns `python /opt/librosa-mcp/server_extended.py` as a stdio child — so a service restart re-execs the Python process with the new file.

---

## Step 1 — Copy the updated file from your laptop to EC2

From the project root on your machine (replace `<EC2_HOST>` with your DNS / IP, e.g. `mcp.audio.example.com` or the EC2 public IPv4):

```bash
scp deploy/librosa-mcp/server_extended.py ubuntu@<EC2_HOST>:/tmp/server_extended.py
```

If you use a non-default SSH key, add `-i ~/.ssh/your-key.pem`. If your EC2 user isn't `ubuntu`, swap that too.

## Step 2 — SSH in and move it into place

```bash
ssh ubuntu@<EC2_HOST>
sudo cp /tmp/server_extended.py /opt/librosa-mcp/server_extended.py
sudo chown ubuntu:ubuntu /opt/librosa-mcp/server_extended.py
```

Quick sanity check that the new code is on disk (should print the new error string):

```bash
grep -n "is not a recognized audio file" /opt/librosa-mcp/server_extended.py
```

## Step 3 — Restart the service

```bash
sudo systemctl restart librosa-mcp
sudo systemctl status librosa-mcp --no-pager | head -n 20
```

You want `Active: active (running)`. If it's `failed`, jump to Troubleshooting.

## Step 4 — Tail the logs while you test

In one terminal:

```bash
sudo journalctl -u librosa-mcp -f
```

Leave it open and trigger an upload from the Lovable admin UI (`/admin/integrations` → MCP Servers → Audio sample test). You should see the `download_from_url` call succeed and the `load` + analysis tool calls follow.

## Step 5 — Retry from the app

1. Open `https://id-preview--ce2afc2f-4a7a-4aa1-8bd5-f8a0db891541.lovable.app/admin/integrations`
2. Switch to the **MCP Servers** tab.
3. In the **Librosa MCP — Audio sample test** card, pick a small `.mp3` or `.wav` (≤ 30s is best for a first test), choose `get_duration`, and click **Send to Librosa**.
4. You should see a result and a latency in milliseconds instead of the 504.

---

## Troubleshooting

| Symptom | What to check / try |
|---|---|
| `scp: Permission denied` | Add `-i <key.pem>` and ensure your security group allows SSH (TCP 22) from your IP. |
| `cp: cannot create … Permission denied` | You forgot `sudo` on Step 2. |
| `systemctl status` shows `failed` | Run `sudo journalctl -u librosa-mcp -n 100 --no-pager` — most likely a Python syntax error in the new file. Restore the previous copy and re-scp. |
| Upload still hits 504 | Confirm with `grep` in Step 2 that the new string is present. If yes, tail logs (Step 4) during the call — the MCP will now print the real error (e.g. timeout downloading the signed URL). |
| Want to roll back fast | `sudo systemctl stop librosa-mcp` then restore from `/opt/librosa-mcp/server_extended.py.bak` if you made one before Step 2. To be safe, run `sudo cp /opt/librosa-mcp/server_extended.py /opt/librosa-mcp/server_extended.py.bak` before Step 2. |

## Optional — One-liner version

If you're comfortable, the whole thing collapses to:

```bash
scp deploy/librosa-mcp/server_extended.py ubuntu@<EC2_HOST>:/tmp/srv.py && \
ssh ubuntu@<EC2_HOST> 'sudo cp /tmp/srv.py /opt/librosa-mcp/server_extended.py && \
  sudo chown ubuntu:ubuntu /opt/librosa-mcp/server_extended.py && \
  sudo systemctl restart librosa-mcp && \
  sudo systemctl status librosa-mcp --no-pager | head -n 10'
```
