# Phase 5 runbook — scaling the librosa worker once you control the box

Nothing here is required by the app. Phases 1–4 already made the analysis path
queue-driven, cached, and status-based, so every step below is a drop-in swap
behind the same HTTP contract (`/health`, `/analyze`, `/analyze_full`, Bearer
token). The frontend, edge functions, and database never learn that anything
moved.

Do the steps in order; each one is independently reversible.

---

## Step 0 — Baseline (5 min, no changes)

```bash
grep -n 'server 127' /etc/nginx/sites-enabled/librosa-mcp   # which loopback port nginx uses
systemctl show librosa-rest -p ExecStart                    # which port the service binds
nproc && free -m                                            # cores and RAM budget
```

Record current p50/p95 upstream latency and failure rate from the admin health
panel (Librosa health) — that's the before/after yardstick.

## Step 1 — Multi-worker + tmpfs on the existing instance (no port/nginx change)

```bash
sudo cp gunicorn.conf.py /opt/librosa-mcp/gunicorn.conf.py
/opt/librosa-mcp/.venv/bin/pip install 'gunicorn==23.0.0' 'uvicorn[standard]==0.32.1'
sudo mkdir -p /etc/systemd/system/librosa-rest.service.d
sudo cp librosa-rest-tuning.conf /etc/systemd/system/librosa-rest.service.d/tuning.conf
# set LIBROSA_BIND in the drop-in to the port from Step 0, then:
sudo systemctl daemon-reload && sudo systemctl restart librosa-rest
curl -fsS -H "Authorization: Bearer $(sudo cat /etc/librosa-rest.token)" http://127.0.0.1:8766/health
```

Sizing rule: `LIBROSA_WORKERS = min(nproc - 1, floor(RAM_GB / 1.5))`. Raise
`MAX_INFLIGHT` in `supabase/functions/_shared/librosa.ts` to the same number —
that edge-side cap is what protects the box, so it must move deliberately.

Rollback: `sudo rm /etc/systemd/system/librosa-rest.service.d/tuning.conf && sudo systemctl daemon-reload && sudo systemctl restart librosa-rest`.

## Step 2 — Containerize (same instance, same port)

```bash
docker build -t librosa-rest:latest -f Dockerfile .
docker run -d --name librosa-rest \
  -p 127.0.0.1:8766:8766 \
  --env-file /etc/librosa-rest.env \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g \
  --memory 6g --cpus "$(nproc)" \
  --restart unless-stopped librosa-rest:latest
```

Stop the systemd unit only after the container answers `/health` on the same
port (`sudo systemctl disable --now librosa-rest`). nginx is untouched.

Publish to ECR when the container is proven:

```bash
aws ecr create-repository --repository-name librosa-rest
docker tag librosa-rest:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/librosa-rest:$(git rev-parse --short HEAD)"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/librosa-rest:$(git rev-parse --short HEAD)"
```

Tag by commit, never rely on `latest` for the ASG launch template.

## Step 3 — Queue-driven autoscaling

```text
analysis_jobs (Postgres)
      |  pending + processing count, once a minute
      v
publish-queue-depth.sh --> CloudWatch  SonicSIM/Analysis/PendingJobsPerWorker
                                   |
                        target-tracking policy (target = 3)
                                   v
                 ASG: librosa-workers  min 1 / max N / warmup 180s
                                   v
              ALB (internal) --> :8766 on each worker, /health check
```

- Metric publisher: `publish-queue-depth.sh` (cron, one minute). Needs
  `cloudwatch:PutMetricData` and `autoscaling:DescribeAutoScalingGroups`.
- Target tracking on `PendingJobsPerWorker` with target `3`: roughly three
  queued jobs per worker keeps utilisation high without long waits.
- Scale-in protection while a job is in flight: the worker drains on SIGTERM
  (gunicorn `graceful_timeout=30`); jobs interrupted anyway return to `pending`
  by the existing `claim_analysis_jobs` staleness path, so no work is lost.
- Spot for the bulk of capacity: mixed-instances policy, 80% spot / 20%
  on-demand base. Interruptions are safe for the same reason.

## Step 4 — Ingress and network

- Put an internal ALB in front of the workers; target group health check
  `GET /health` with the Bearer header stripped (add `/healthz` unauthenticated
  if the check can't send headers).
- Move workers to a private subnet, ALB in public subnets, security group
  allowing only the ALB on the worker port.
- Point `LIBROSA_REST_URL` in the admin integrations page at the ALB DNS name.
  That single credential change is the entire cutover — no code deploy.

## Step 5 — Verify

- Admin health panel: cache hit rate steady, p95 upstream latency down, queue
  depth draining faster than it fills under a warm-cache backfill.
- `librosa_call_log`: no rise in `error` outcomes after each step.
- Load test with the backfill button ("Warm cache") rather than synthetic
  traffic — it exercises the real queue and cache paths.

## Guardrails

- Never raise edge concurrency (`MAX_INFLIGHT`) before worker capacity exists.
- Keep the circuit breaker in place; it is what makes the migration safe.
- Never bake the REST token or any service-role key into an image or launch
  template — pass them via SSM Parameter Store / Secrets Manager at boot.
