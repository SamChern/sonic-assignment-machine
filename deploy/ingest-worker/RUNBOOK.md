# Ingest worker runbook — queue-free (pull) mode

Copy-paste, one block at a time, and read what comes back before the next one.
This is Part 4 of your EC2 runbook, corrected for how the app actually works now:

* **No SQS queue.** The worker asks the app for the next file (a "lease"). Nothing
  to create in AWS beyond the S3 read access you already have.
* **No service role key.** Lovable Cloud does not expose one. The worker
  authenticates with a shared secret you generate on the box yourself.

## 0 — What you need

* SSH access to the box (`ssh -i <key.pem> ubuntu@<host>`).
* The app's backend URL — the `SUPABASE_URL`-style `https://<ref>.supabase.co`
  address. Ask in chat and it will be pasted for you; it is not a secret.
* The S3 key/secret/region/bucket the app already uses.

## 1 — Get the code onto the box

Check whether your checkout tracks the GitHub repo Lovable syncs to:

```bash
whoami
ls -d ~/*/deploy/ingest-worker 2>/dev/null
git -C ~/sonic-assignment-machine remote -v 2>/dev/null
```

**If the `git remote` printed a URL:**

```bash
cd ~/sonic-assignment-machine && git pull
cd deploy/ingest-worker
```

**If it printed nothing** (no git checkout), fetch the three files directly:

```bash
mkdir -p ~/ingest-worker && cd ~/ingest-worker
for f in worker.py normalize.py iab_labels.py requirements.txt; do
  curl -fsSL "https://sonicsimai.lovable.app/ingest-worker/$f" -o "$f"
done
ls -l
```

## 2 — Python environment

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**Expect:** `Successfully installed … duckdb … requests …`. If pip prints
`Killed`, the box ran out of memory — say so in chat and you'll get the swap fix.

## 3 — Generate the shared secret

On the box:

```bash
openssl rand -hex 32
```

Copy that 64-character string. Paste it into chat **once** when asked for
`INGEST_WORKER_SECRET`, so the same value is stored in the app's backend. Then
put it in the worker's settings file below. Nothing else uses it.

## 4 — Settings file

```bash
cat > .env <<'EOF'
SUPABASE_URL=https://YOURREF.supabase.co
INGEST_WORKER_SECRET=PASTE_THE_64_CHAR_STRING
MODE=pull
S3_BUCKET=PASTE_BUCKET_NAME
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=PASTE_S3_KEY
AWS_SECRET_ACCESS_KEY=PASTE_S3_SECRET
POLL_SECONDS=20
EOF
chmod 600 .env
nano .env      # fill in the five PASTE_ values, Ctrl+O Enter Ctrl+X
```

There is deliberately **no** `SUPABASE_SERVICE_KEY` and **no** `SQS_QUEUE_URL`.

## 5 — Test run in the open

```bash
set -a; source .env; set +a
python worker.py
```

**Expect** one of two things:

* `claimed <key> at row 0` → `rows 50000/…` → `done {...}` — it is draining.
* `no pending files; waiting for the control plane to discover more` — the
  ledger has nothing pending; run a discovery pass from the app's admin ingest
  panel, then watch this window.

A `401` means the secret in `.env` does not match the one stored in the app.
Press `Ctrl+C` to stop.

## 6 — Make it permanent

Adjust the three paths if your directory is `~/ingest-worker` rather than the git
checkout, and `ubuntu` if `whoami` said otherwise.

```bash
sudo tee /etc/systemd/system/ingest-worker.service > /dev/null <<'EOF'
[Unit]
Description=SONICSIM ingest worker (pull mode)
After=network-online.target
Wants=network-online.target
[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/sonic-assignment-machine/deploy/ingest-worker
EnvironmentFile=/home/ubuntu/sonic-assignment-machine/deploy/ingest-worker/.env
ExecStart=/home/ubuntu/sonic-assignment-machine/deploy/ingest-worker/venv/bin/python worker.py
KillSignal=SIGTERM
TimeoutStopSec=180
Restart=always
RestartSec=5
CPUQuota=140%
MemoryMax=3G
Nice=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ingest-worker
systemctl status ingest-worker --no-pager | head -8
```

**Expect:** `active (running)`.

## 7 — Health check, any time

```bash
systemctl is-active ingest-worker librosa-rest
journalctl -u ingest-worker -n 20 --no-pager
```

In the app: **Admin → SonicSIM analysis results → ingest ledger** shows each
file's `worker` and `heartbeat` — a fresh heartbeat is proof the box and the app
are talking.

## Troubleshooting

| You see | Means | Do |
| --- | --- | --- |
| `401` from the callback | secret mismatch | re-paste the same string in chat and in `.env`, then `sudo systemctl restart ingest-worker` |
| `no pending files` forever | nothing discovered | run a discovery pass in the admin ingest panel |
| `IO Error … 403` from DuckDB | S3 keys lack read on the bucket | check `AWS_ACCESS_KEY_ID`/`SECRET` and `S3_BUCKET` |
| rows stuck at `processing` | worker died mid-file | restart it; the lease expires after 15 min of no heartbeat and is re-claimed from the saved cursor |
| `MODE=sqs needs SQS_QUEUE_URL` | `MODE` not set to `pull` | fix `.env` |

Keep the `.pem` file and the shared secret private. Neither belongs in the repo.
