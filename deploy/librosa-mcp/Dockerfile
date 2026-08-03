# Phase 5 — containerized librosa REST worker.
#
# Build:  docker build -t librosa-rest:latest -f Dockerfile .
# Run:    docker run --rm -p 127.0.0.1:8766:8766 \
#           --env-file /etc/librosa-rest.env \
#           --tmpfs /tmp:rw,noexec,nosuid,size=1g \
#           librosa-rest:latest
#
# The HTTP contract is byte-identical to the systemd deployment: same routes,
# same Bearer auth, same JSON. Nothing in the app or the edge functions changes.
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLCONFIGDIR=/tmp/matplotlib-librosa \
    NUMBA_CACHE_DIR=/tmp/numba-cache \
    XDG_CACHE_HOME=/tmp/cache

# ffmpeg is required for audio decoding; libsndfile for soundfile/librosa I/O.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg libsndfile1 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/librosa-mcp

# Dependencies first so code edits don't invalidate the wheel layer.
COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

COPY server_extended.py server_rest.py gunicorn.conf.py ./

RUN useradd --create-home --uid 10001 librosa \
 && chown -R librosa:librosa /opt/librosa-mcp
USER librosa

EXPOSE 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:8766/healthz || exit 1

# Gunicorn supervises N uvicorn workers; see gunicorn.conf.py for sizing.
CMD ["gunicorn", "-c", "gunicorn.conf.py", "server_rest:app"]
