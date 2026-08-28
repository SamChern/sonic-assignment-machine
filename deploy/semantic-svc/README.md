# SonicSIM Semantic Service (Step 2) — EC2 runbook

This is the sound-grounded half of the semantic engine. Everything in this
folder runs **on your EC2 box**, alongside the existing librosa services. The
app never calls it directly — edge functions reach it through the same
`aws-proxy` path already used for librosa.

- Port `8769` (loopback), public path `/semantic/*` via nginx
- Own venv at `/opt/semantic-svc/.venv` (never shares the librosa venv)
- Model: LAION-CLAP `630k-audioset-best`, 512-d text and audio embeddings
- Bridge: 512 → 1536 projection, **identity stub** until Step 8 trains weights

## Why a second service instead of extending librosa-rest

librosa-rest pins numpy/numba for DSP. CLAP pulls torch, which pins those
differently. Two venvs, two systemd units, two ports — a torch upgrade can
never take the DSP pipeline down with it. Same box, same nginx, same auth shape.

## Install

```bash
scp -r deploy/semantic-svc ubuntu@<host>:/tmp/
ssh ubuntu@<host> 'sudo bash /tmp/semantic-svc/install.sh'
```

The install script is idempotent. It creates the venv, installs pinned CPU
torch wheels, generates `/etc/semantic-svc.token`, warms the CLAP checkpoint
into `/opt/semantic-svc/cache`, and starts `semantic-svc` under systemd.

First install takes 10–20 minutes: torch wheels are ~200 MB and the CLAP
checkpoint is ~2 GB.

## Wire up nginx (manual, one time)

Merge `nginx-semantic-svc.conf` into the **existing** `server { listen 443 ssl; }`
block that already serves `/librosa-rest/`. Replace `TOKEN_GOES_HERE` with the
contents of `/etc/semantic-svc.token`, then:

```bash
nginx -t && systemctl reload nginx
```

## Verify

```bash
TOKEN=$(sudo cat /etc/semantic-svc.token)
bash deploy/semantic-svc/smoke-test.sh https://<your-host>/semantic "$TOKEN"
```

The smoke test asserts: `/healthz` responds, `/embed_text` returns 512 dims,
`/bridge` returns 1536 dims, and cosine similarity is preserved through the
bridge (the property that makes the identity stub safe to ship).

## Connect it to the app

In SonicSIM: **Admin → APIs & MCPs**, set the semantic service base URL
(`https://<your-host>/semantic`) and the token. Edge functions read these from
the credentials manager — no code change needed to point at a new host.

## Capacity notes for this box

The instance has **2 vCPU / 7 GB and no GPU**. Config reflects that:

- one gunicorn worker (the resident CLAP model is ~1.5 GB; more workers = more copies)
- `OMP_NUM_THREADS=2` so torch cannot starve nginx and librosa
- `MemoryMax=3G` leaves headroom for librosa-rest on the same box

Throughput is roughly **10–20 text embeddings/sec batched** and **1–3 audio
embeddings/sec**. Batch `/embed_text` calls (up to 256 per request) rather than
looping single texts — batching is where nearly all the speedup is.

If audio embedding throughput becomes the bottleneck, that is the signal to move
this one service to a GPU instance. Do not put a chat LLM on this box.

## Operating

```bash
systemctl status semantic-svc
journalctl -u semantic-svc -f
systemctl restart semantic-svc      # first request after restart re-loads the model (~30-60s)
```

## Bridge lifecycle

`/bridge` with no `bridge_id` uses the identity stub: tile the 512-d vector 3×
and L2-normalize. Cosine similarity between tiled vectors equals cosine
similarity between the originals, so kNN ranking in the 1536-d store is exactly
preserved — the pipeline is correct before any training happens.

When Step 8 trains real weights, upload an `.npz` with `W1,b1,W2,b2`, insert a
row into `public.embedding_bridges` (`from_dim` 512, `to_dim` 1536, `weights_url`,
`eval_agreement`) and flip `is_active`. The service fetches and caches the
weights on first use. Nothing downstream changes.
