# Gunicorn config for the SonicSIM semantic (CLAP) service — Step 2.
#
# Shape differs from librosa: the CLAP model is a large resident object, so more
# workers means more copies of it in RAM. On the 2 vCPU / 7GB box the right
# answer is ONE worker with a couple of threads — embedding calls are short and
# torch already uses both cores internally.
import os

bind = os.environ.get("SEMANTIC_BIND", "127.0.0.1:8767")

workers = int(os.environ.get("SEMANTIC_WORKERS", 1))
worker_class = "uvicorn.workers.UvicornWorker"
threads = int(os.environ.get("SEMANTIC_THREADS", 2))
worker_connections = 16

# First request pays the model load (~30-60s cold). Keep the timeout generous
# enough to survive it, short enough to recycle a wedged worker.
timeout = int(os.environ.get("SEMANTIC_TIMEOUT", 180))
graceful_timeout = 30
keepalive = 30

# Recycle occasionally: torch allocator fragments over thousands of calls.
max_requests = int(os.environ.get("SEMANTIC_MAX_REQUESTS", 500))
max_requests_jitter = 50

accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("SEMANTIC_LOGLEVEL", "info")
