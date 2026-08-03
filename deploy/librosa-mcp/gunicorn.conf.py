# Gunicorn config for the librosa REST worker (Phase 5).
#
# Analysis is CPU-bound and mostly single-threaded inside librosa/numba, so the
# right shape is: one uvicorn worker per usable core, each handling one request
# at a time, with a hard timeout so a pathological file can't wedge a slot.
import multiprocessing
import os

bind = os.environ.get("LIBROSA_BIND", "0.0.0.0:8766")

# Leave one core for nginx/system when running on the EC2 box; never below 1.
_cores = multiprocessing.cpu_count()
workers = int(os.environ.get("LIBROSA_WORKERS", max(1, _cores - 1)))
worker_class = "uvicorn.workers.UvicornWorker"

# One in-flight analysis per worker keeps latency predictable and matches the
# edge-side concurrency cap (MAX_INFLIGHT) in supabase/functions/_shared/librosa.ts.
worker_connections = 8
threads = 1

# Long enough for download + full analysis, short enough to recycle a stuck job.
timeout = int(os.environ.get("LIBROSA_TIMEOUT", 300))
graceful_timeout = 30
keepalive = 30

# Recycle workers periodically: librosa/numba caches and matplotlib figures leak
# slowly over thousands of requests.
max_requests = int(os.environ.get("LIBROSA_MAX_REQUESTS", 200))
max_requests_jitter = 25

# Scratch space must be tmpfs-backed (see librosa-rest-tuning.conf / --tmpfs).
worker_tmp_dir = os.environ.get("LIBROSA_TMP", "/tmp")

preload_app = False  # numba JIT state is not fork-safe; let each worker warm up.

accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LIBROSA_LOGLEVEL", "info")
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s %(L)ss'
